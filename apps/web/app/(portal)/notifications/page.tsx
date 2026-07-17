import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { listPendingApprovals } from "@/lib/server/approvals";
import { ApprovalCard } from "@/components/approval-card";
import { MarkAllReadButton } from "./mark-read";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireOnboardedUser();
  const items = await scopeFor(user.id).listNotifications();
  const pendingApprovals = await listPendingApprovals(user.id);

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-gap">
      {pendingApprovals.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="font-disp text-[13.5px] font-bold">Waiting for your approval</h2>
          {pendingApprovals.map((a) => (
            <div key={a.id} id={a.id}>
              <ApprovalCard
                approvalId={a.id}
                title={a.title}
                summary={a.summary}
                detail={JSON.stringify(a.payload, null, 2)}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center">
        <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
          Notifications
        </h1>
        {items.some((n) => !n.readAt) ? (
          <div className="ml-auto">
            <MarkAllReadButton />
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-cardpad py-10">
          <p className="text-center text-[12.5px] text-muted">
            Alerts, approvals, and updates from Tess arrive here.
          </p>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface">
          {items.map((n, i) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-cardpad py-rowpad ${i > 0 ? "border-t border-line" : ""}`}
            >
              <span
                className={`mt-[6px] h-[7px] w-[7px] shrink-0 rounded-pill ${n.readAt ? "bg-track" : "bg-jade"}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold">
                  {n.href ? (
                    <Link href={n.href} className="text-fg hover:text-jade">
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                </div>
                {n.body ? <div className="mt-0.5 text-[11.5px] text-muted">{n.body}</div> : null}
              </div>
              <span className="shrink-0 font-mono text-[10.5px] text-faint">
                {n.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
