import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";

export const metadata: Metadata = { title: "Audit Log" };
export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const user = await requireOnboardedUser();
  const entries = await scopeFor(user.id).listAuditEntries();

  return (
    <div className="flex flex-col gap-gap">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
        Audit Log
      </h1>
      <p className="text-[11.5px] text-muted">
        Your sensitive actions, recorded with the exact content at the time. Only you see these
        entries.
      </p>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-cardpad py-10">
          <p className="text-center text-[12.5px] text-muted">
            Every sensitive action is recorded here with who did it, when, and the exact content.
          </p>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface">
          {entries.map((e, i) => (
            <div
              key={e.id}
              className={`flex items-start gap-3 px-cardpad py-rowpad ${i > 0 ? "border-t border-line" : ""}`}
            >
              <span className="mt-[2px] shrink-0 rounded-pill bg-jade-dim px-[8px] py-[2.5px] font-mono text-[10px] text-jade">
                {e.action}
              </span>
              <div className="min-w-0 flex-1">
                {e.targetId ? (
                  <div className="truncate text-[12px] text-muted">
                    {e.targetType ? `${e.targetType}: ` : ""}
                    {e.targetId}
                  </div>
                ) : null}
                {e.snapshot ? (
                  <pre className="mt-1 overflow-x-auto rounded-[8px] bg-bg px-2.5 py-1.5 font-mono text-[10.5px] text-faint">
                    {JSON.stringify(e.snapshot)}
                  </pre>
                ) : null}
              </div>
              <span className="shrink-0 font-mono text-[10.5px] text-faint">
                {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
