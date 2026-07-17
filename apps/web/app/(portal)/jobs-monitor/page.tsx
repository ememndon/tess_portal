import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { requireOnboardedUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { TaskRow } from "./monitor-client";

export const metadata: Metadata = { title: "Jobs Monitor" };
export const dynamic = "force-dynamic";

export default async function JobsMonitorPage() {
  await requireOnboardedUser();
  const tasks = await getDb()
    .select()
    .from(schema.scheduledTasks)
    .orderBy(asc(schema.scheduledTasks.id));

  const failing = tasks.filter((t) => t.lastStatus === "failed").length;
  const nextDue = tasks
    .map((t) => t.nextRunAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
        Jobs Monitor
      </h1>

      <div className="mt-gap grid grid-cols-3 gap-gap">
        <div className="rounded-card border border-line bg-surface p-cardpad">
          <div className="text-[11px] font-medium text-muted">Total tasks</div>
          <div className="mt-1 font-disp text-[22px] font-extrabold tracking-[-0.02em]">{tasks.length}</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-cardpad">
          <div className="text-[11px] font-medium text-muted">Failing</div>
          <div className="mt-1 font-disp text-[22px] font-extrabold tracking-[-0.02em]" style={failing > 0 ? { color: "var(--red)" } : undefined}>
            {failing}
          </div>
        </div>
        <div className="rounded-card border border-line bg-surface p-cardpad">
          <div className="text-[11px] font-medium text-muted">Next due</div>
          <div className="mt-1 font-mono text-[13px] text-fg">
            {nextDue ? nextDue.toISOString().slice(11, 16) + " UTC" : "on schedule"}
          </div>
        </div>
      </div>

      <div className="mt-gap columns-1 [column-gap:var(--gap)] [&>*]:mb-gap [&>*]:break-inside-avoid">
        <div className="rounded-card border border-line bg-surface">
          <div className="flex items-center p-cardpad pb-2.5">
            <h2 className="font-disp text-[13.5px] font-bold">Scheduled tasks</h2>
          </div>
          {tasks.length === 0 ? (
            <div className="border-t border-line px-cardpad py-rowpad text-[12px] text-muted">
              Tasks register themselves as the worker boots. If this stays empty, check the worker.
            </div>
          ) : (
            tasks.map((t) => {
              const total = t.successCount + t.failCount;
              return (
                <TaskRow
                  key={t.id}
                  id={t.id}
                  name={t.name}
                  schedule={t.schedule}
                  critical={t.critical}
                  enabled={t.enabled}
                  lastRunAt={t.lastRunAt?.toISOString() ?? null}
                  lastStatus={t.lastStatus}
                  lastResult={t.lastResult}
                  lastDurationMs={t.lastDurationMs}
                  successRate={total > 0 ? Math.round((t.successCount / total) * 100) : null}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
