import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { runDiscoveryForUser } from "./run";
import { sendDigestForUser } from "./digest";

/**
 * Discovery scheduled tasks: the 60-day purge and the staggered
 * per-user overnight runs. One overnight orchestrator is registered in
 * Jobs Monitor; it spreads users across the admin-configured window
 * and caps concurrency so they never all fire at once, sharing the box
 * politely with Tess Console's nightly video renders.
 */

const DEFAULT_WINDOW = { startHour: 2, endHour: 6 };
const MAX_USERS_PER_TICK = 2;

async function scheduleWindow(db: Db): Promise<{ startHour: number; endHour: number }> {
  const rows = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, "schedule.window")).limit(1);
  const w = rows[0]?.value as { startHour?: number; endHour?: number } | null;
  return { startHour: w?.startHour ?? DEFAULT_WINDOW.startHour, endHour: w?.endHour ?? DEFAULT_WINDOW.endHour };
}

/** Removes unsaved discovered jobs older than 60 days. Saved jobs are permanent. */
export async function purgeOldJobs(db: Db): Promise<string> {
  const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const deleted = await db
    .delete(schema.jobs)
    .where(and(eq(schema.jobs.saved, false), lt(schema.jobs.createdAt, cutoff)))
    .returning({ id: schema.jobs.id });
  return `purged ${deleted.length} unsaved job${deleted.length === 1 ? "" : "s"} older than 60 days`;
}

function slotOffsetMinutes(userId: string, windowMinutes: number): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return hash % Math.max(1, windowMinutes);
}

/**
 * Runs every ~15 minutes. Inside the window, runs discovery + digest
 * for any user whose stagger slot has arrived and who has not run
 * today. Bounded per tick so load spreads across the window.
 */
export async function overnightOrchestrator(db: Db, redis: Redis, log: Logger): Promise<string> {
  const { startHour, endHour } = await scheduleWindow(db);
  const now = new Date();
  const hour = now.getUTCHours();
  const inWindow = startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
  if (!inWindow) return `outside the ${startHour}:00-${endHour}:00 UTC window`;

  const windowMinutes = ((endHour - startHour + 24) % 24 || 24) * 60;
  const minutesIntoWindow = ((hour - startHour + 24) % 24) * 60 + now.getUTCMinutes();
  const today = now.toISOString().slice(0, 10);

  const users = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.userSettings, eq(schema.userSettings.userId, schema.users.id))
    .where(sql`${schema.users.onboardedAt} is not null`);

  let ran = 0;
  for (const u of users) {
    if (ran >= MAX_USERS_PER_TICK) break;
    const key = `discovery.lastrun:${u.id}`;
    const marker = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, key)).limit(1);
    if ((marker[0]?.value as { day?: string } | null)?.day === today) continue;
    if (minutesIntoWindow < slotOffsetMinutes(u.id, windowMinutes)) continue;

    try {
      const result = await runDiscoveryForUser(db, log, u.id);
      await sendDigestForUser(db, redis, log, u.id);
      await db
        .insert(schema.appMeta)
        .values({ key, value: { day: today } })
        .onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { day: today }, updatedAt: new Date() } });
      log.info({ user: u.id, found: result.found }, "overnight discovery ran");
      ran += 1;
    } catch (err) {
      log.error({ user: u.id, err: (err as Error).message }, "overnight discovery failed");
    }
  }

  return ran > 0 ? `ran overnight discovery for ${ran} user${ran === 1 ? "" : "s"}` : "no users due this tick";
}
