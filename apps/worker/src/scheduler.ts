import { Queue, Worker as BullWorker } from "bullmq";
import { Redis } from "ioredis";
import { and, eq, isNull, lt, notInArray, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { dispatchDueReminders } from "./reminders";
import { getPlatformSmtp } from "./mail";
import { fetchCurrencyRates } from "./discovery/currency";
import { ingestSponsors } from "./discovery/sponsors";
import { resolveSponsorBoards } from "./discovery/ats-resolve";
import { monitorWatchlists } from "./discovery/watchlist";
import { overnightOrchestrator, purgeOldJobs } from "./discovery/tasks";
import { runDiscoveryForUser } from "./discovery/run";
import { pollAllInboxes, runSequencer } from "./inbox";
import { monitorVisaPages } from "./intel/visa";
import { detectCompanySignals } from "./intel/signals";
import { monitorDeliverability } from "./health/deliverability";

const { scheduledTasks, taskRuns, appMeta, usageEvents, capConfig, users, notifications, approvals } = schema;

/**
 * BullMQ scheduling. Every recurring task registers itself in the
 * scheduled_tasks registry that feeds the Jobs Monitor, records
 * task_runs history, respects the per-task pause toggle, and skips
 * while the global pause is on. A task may set pauseExempt to keep
 * running under the pause. Retries with backoff, bounded concurrency.
 */

type TaskDef = {
  id: string;
  name: string;
  schedule: string;
  cron: string;
  critical: boolean;
  pauseExempt?: boolean;
  run: (ctx: Ctx) => Promise<string>;
};

type Ctx = { db: Db; redis: Redis; log: Logger };

async function globallyPaused(db: Db): Promise<boolean> {
  const rows = await db.select().from(appMeta).where(eq(appMeta.key, "global.pause")).limit(1);
  return Boolean((rows[0]?.value as { paused?: boolean } | null)?.paused);
}

const TASKS: TaskDef[] = [
  {
    id: "reminders.dispatch",
    name: "Reminder emails",
    schedule: "every minute",
    cron: "* * * * *",
    critical: false,
    run: (ctx) => dispatchDueReminders(ctx.db, ctx.redis, ctx.log),
  },
  {
    id: "cap.metering",
    name: "Cap metering",
    schedule: "every 10 minutes",
    cron: "*/10 * * * *",
    critical: true,
    run: async ({ db, redis }) => {
      const month = new Date().toISOString().slice(0, 7);
      const [row] = await db
        .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
        .from(usageEvents)
        .where(sql`to_char(${usageEvents.createdAt}, 'YYYY-MM') = ${month}`);
      const spend = Number(row.total);
      await redis.set(`spend:${month}`, String(spend), "EX", 3600);

      const capRows = await db.select().from(capConfig).where(eq(capConfig.id, 1)).limit(1);
      const cap = Number(capRows[0]?.monthlyCapUsd ?? 40);
      const alertPct = capRows[0]?.alertAtPct ?? 80;
      if (cap > 0 && spend >= (cap * alertPct) / 100) {
        const marker = await db.select().from(appMeta).where(eq(appMeta.key, "cap.alerted")).limit(1);
        if ((marker[0]?.value as { month?: string } | null)?.month !== month) {
          await db
            .insert(appMeta)
            .values({ key: "cap.alerted", value: { month } })
            .onConflictDoUpdate({ target: appMeta.key, set: { value: { month }, updatedAt: new Date() } });
          const everyone = await db.select({ id: users.id, email: users.email }).from(users);
          const title = `AI budget alert: ${Math.round((spend / cap) * 100)}% of the $${cap} cap is used`;
          const smtp = await getPlatformSmtp(db);
          for (const u of everyone) {
            const [n] = await db
              .insert(notifications)
              .values({ userId: u.id, type: "cap.alert", title, body: `$${spend.toFixed(2)} of $${cap} spent.`, href: "/admin" })
              .returning();
            await redis
              .publish(`notify:${u.id}`, JSON.stringify({ unread: 1, notification: { id: n.id, title, type: "cap.alert" } }))
              .catch(() => {});
            if (smtp) {
              await smtp.transport
                .sendMail({ from: smtp.from, to: u.email, subject: title, text: `$${spend.toFixed(2)} of $${cap} is spent this month. At 100% the platform degrades to free models only.` })
                .catch(() => {});
            }
          }
        }
      }
      return `spend $${spend.toFixed(2)} of $${cap}`;
    },
  },
  {
    id: "approvals.processing",
    name: "Approval processing watchdog",
    schedule: "every 5 minutes",
    cron: "*/5 * * * *",
    critical: true,
    run: async ({ db, redis }) => {
      // nudge users about approvals that sat pending for over a day
      const stale = await db
        .select()
        .from(approvals)
        .where(and(eq(approvals.status, "pending"), lt(approvals.createdAt, new Date(Date.now() - 24 * 3600 * 1000)), isNull(approvals.decidedAt)))
        .limit(20);
      let nudged = 0;
      for (const a of stale) {
        const dupe = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(eq(notifications.userId, a.userId), eq(notifications.type, "approval.stale"), sql`${notifications.href} = ${"/notifications#" + a.id}`))
          .limit(1);
        if (dupe[0]) continue;
        const [n] = await db
          .insert(notifications)
          .values({
            userId: a.userId,
            type: "approval.stale",
            title: `Still waiting for you: ${a.title}`,
            body: "This has been pending for over a day.",
            href: `/notifications#${a.id}`,
          })
          .returning();
        await redis.publish(`notify:${a.userId}`, JSON.stringify({ unread: 1, notification: { id: n.id, title: n.title, type: n.type } })).catch(() => {});
        nudged += 1;
      }
      return nudged > 0 ? `nudged ${nudged} stale approval${nudged === 1 ? "" : "s"}` : "no stale approvals";
    },
  },
  {
    id: "discovery.currency",
    name: "Currency rates",
    schedule: "daily 05:00",
    cron: "0 5 * * *",
    critical: false,
    run: ({ db }) => fetchCurrencyRates(db),
  },
  {
    id: "discovery.sponsors",
    name: "Sponsor register ingest",
    schedule: "weekly Monday 04:00",
    cron: "0 4 * * 1",
    critical: false,
    run: ({ db, log }) => ingestSponsors(db, log),
  },
  {
    id: "discovery.watchlist",
    name: "Watchlist monitoring",
    schedule: "every 4 hours",
    cron: "0 */4 * * *",
    critical: false,
    run: ({ db, log }) => monitorWatchlists(db, log),
  },
  {
    id: "discovery.boards",
    name: "Sponsor ATS board resolution",
    schedule: "daily 04:30",
    cron: "30 4 * * *",
    critical: false,
    run: ({ db, log }) => resolveSponsorBoards(db, log),
  },
  {
    id: "discovery.overnight",
    name: "Overnight discovery runs",
    schedule: "every 15 min in the window",
    cron: "*/15 * * * *",
    critical: false,
    run: ({ db, redis, log }) => overnightOrchestrator(db, redis, log),
  },
  {
    id: "discovery.purge",
    name: "60-day purge",
    schedule: "daily 03:30",
    cron: "30 3 * * *",
    critical: false,
    run: ({ db }) => purgeOldJobs(db),
  },
  {
    id: "inbox.poll",
    name: "Inbox monitoring",
    schedule: "every 10 minutes",
    cron: "*/10 * * * *",
    critical: false,
    run: ({ db, redis, log }) => pollAllInboxes(db, redis, log),
  },
  {
    id: "outreach.sequencer",
    name: "Outreach follow-ups",
    schedule: "every 30 minutes",
    cron: "*/30 * * * *",
    critical: false,
    run: ({ db, redis, log }) => runSequencer(db, redis, log),
  },
  {
    id: "intel.visa",
    name: "Visa and register monitoring",
    schedule: "daily 06:00",
    cron: "0 6 * * *",
    critical: false,
    run: ({ db, redis, log }) => monitorVisaPages(db, redis, log),
  },
  {
    id: "intel.signals",
    name: "Company news and funding signals",
    schedule: "every 6 hours",
    cron: "0 */6 * * *",
    critical: false,
    run: ({ db, redis, log }) => detectCompanySignals(db, redis, log),
  },
  {
    id: "health.deliverability",
    name: "Email deliverability monitor",
    schedule: "daily 07:00",
    cron: "0 7 * * *",
    critical: false,
    run: ({ db, redis, log }) => monitorDeliverability(db, redis, log),
  },
];

async function registerTasks(db: Db) {
  for (const t of TASKS) {
    await db
      .insert(scheduledTasks)
      .values({ id: t.id, name: t.name, schedule: t.schedule, critical: t.critical })
      .onConflictDoUpdate({
        target: scheduledTasks.id,
        set: { name: t.name, schedule: t.schedule, critical: t.critical },
      });
  }
  // drop registry rows for tasks that no longer exist (task_runs cascade),
  // so a removed task leaves nothing behind in the Jobs Monitor
  const ids = TASKS.map((t) => t.id);
  await db.delete(scheduledTasks).where(notInArray(scheduledTasks.id, ids));
}

async function runTask(t: TaskDef, ctx: Ctx) {
  const db = ctx.db;
  const [row] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, t.id)).limit(1);
  if (row && !row.enabled && !t.critical) return;

  const startedAt = Date.now();
  let status = "success";
  let result = "";
  if ((await globallyPaused(db)) && !t.pauseExempt) {
    status = "skipped";
    result = "global pause is on";
  } else {
    try {
      result = await t.run(ctx);
    } catch (err) {
      status = "failed";
      result = (err as Error).message.slice(0, 300);
      ctx.log.error({ task: t.id, err: result }, "task failed");
    }
  }
  const durationMs = Date.now() - startedAt;
  await db.insert(taskRuns).values({
    taskId: t.id,
    status,
    resultSummary: result.slice(0, 500),
    durationMs,
    finishedAt: new Date(),
  });
  await db
    .update(scheduledTasks)
    .set({
      lastRunAt: new Date(),
      lastStatus: status,
      lastResult: result.slice(0, 500),
      lastDurationMs: durationMs,
      successCount: sql`${scheduledTasks.successCount} + ${status === "success" ? 1 : 0}`,
      failCount: sql`${scheduledTasks.failCount} + ${status === "failed" ? 1 : 0}`,
    })
    .where(eq(scheduledTasks.id, t.id));
}

export async function startScheduler(db: Db, log: Logger) {
  const connection = () =>
    new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
  const redis = connection();
  const queue = new Queue("tessportal-tasks", { connection: connection() as never });
  const ctx: Ctx = { db, redis, log };

  await registerTasks(db);

  // repeatable jobs, staggered by their own cron offsets
  for (const t of TASKS) {
    await queue.upsertJobScheduler(`sched:${t.id}`, { pattern: t.cron }, { name: t.id, data: {} });
  }
  // remove repeat-schedulers left over from tasks that no longer exist
  const activeKeys = new Set(TASKS.map((t) => `sched:${t.id}`));
  for (const s of await queue.getJobSchedulers()) {
    if (typeof s.key === "string" && s.key.startsWith("sched:") && !activeKeys.has(s.key)) {
      await queue.removeJobScheduler(s.key).catch(() => {});
      log.info({ scheduler: s.key }, "removed stale repeat-scheduler");
    }
  }

  const bullWorker = new BullWorker(
    "tessportal-tasks",
    async (job) => {
      const t = TASKS.find((x) => x.id === job.name);
      if (t) await runTask(t, ctx);
    },
    {
      connection: connection() as never,
      concurrency: 2,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  );
  bullWorker.on("error", (err) => log.error({ err: err.message }, "bull worker error"));

  // on-demand runs from the Jobs Monitor, and per-user discovery from
  // the Discover page's Find jobs now button
  const sub = connection();
  await sub.subscribe("tasks:run-now", "discovery:run-user");
  sub.on("message", (channel, payload) => {
    if (channel === "tasks:run-now") {
      const t = TASKS.find((x) => x.id === payload);
      if (t) {
        log.info({ task: payload }, "on-demand task run");
        runTask(t, ctx).catch((err) => log.error({ err: (err as Error).message }, "on-demand run failed"));
      }
      return;
    }
    if (channel === "discovery:run-user") {
      const userId = payload;
      log.info({ user: userId }, "on-demand discovery run");
      (async () => {
        if (await globallyPaused(db)) {
          log.info("discovery skipped, global pause on");
          return;
        }
        const result = await runDiscoveryForUser(db, log, userId);
        // A manual "Find jobs now" just refreshes Discover — it must NOT email.
        // The digest is sent once a day by the scheduled overnight run.
        await redis.publish(`discovery:done:${userId}`, JSON.stringify(result)).catch(() => {});
        log.info({ user: userId, found: result.found }, "on-demand discovery complete");
      })().catch((err) => log.error({ err: (err as Error).message }, "on-demand discovery failed"));
    }
  });

  log.info({ tasks: TASKS.map((t) => t.id) }, "scheduler running on BullMQ");
  return async () => {
    await bullWorker.close();
    await queue.close();
    await sub.quit().catch(() => {});
    await redis.quit().catch(() => {});
  };
}
