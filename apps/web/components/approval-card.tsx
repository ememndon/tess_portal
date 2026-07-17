"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Approval card, identical anatomy everywhere it appears: what and who
 * in one bold line, one muted summary line, then Approve & send
 * primary and Review secondary.
 */
export function ApprovalCard({
  approvalId,
  title,
  summary,
  detail,
  initialStatus = "pending",
}: {
  approvalId: string;
  title: string;
  summary: string;
  detail?: string;
  initialStatus?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = React.useState(initialStatus);
  const [outcome, setOutcome] = React.useState<string | null>(null);
  const [showDetail, setShowDetail] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    const res = await fetch("/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: approvalId, decision }),
    });
    const payload = (await res.json().catch(() => ({}))) as { status?: string; summary?: string; error?: string };
    setBusy(false);
    if (!res.ok) {
      setOutcome(payload.error ?? "could not decide, try again");
      return;
    }
    setStatus(payload.status ?? decision);
    if (payload.summary) setOutcome(payload.summary);
    router.refresh();
  }

  const decided = status !== "pending";
  return (
    <div className="rounded-[10px] border border-line bg-surface p-cardpad">
      <div className="text-[12.5px] font-semibold leading-relaxed">{title}</div>
      <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{summary}</div>
      {showDetail && detail ? (
        <pre className="mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap rounded-[8px] bg-bg px-2.5 py-2 font-mono text-[10.5px] text-muted">
          {detail}
        </pre>
      ) : null}
      {decided ? (
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`rounded-pill px-[8px] py-[2.5px] font-mono text-[10px] ${
              status === "executed" || status === "approved"
                ? "bg-jade-dim text-jade"
                : status === "rejected"
                  ? "bg-red-dim text-red"
                  : "bg-track text-faint"
            }`}
          >
            {status}
          </span>
          {outcome ? <span className="text-[11px] text-muted">{outcome}</span> : null}
        </div>
      ) : (
        <div className="mt-2.5 flex gap-2">
          <Button onClick={() => decide("approve")} disabled={busy}>
            Approve &amp; send
          </Button>
          <Button
            variant="secondary"
            onClick={() => (detail ? setShowDetail((v) => !v) : decide("reject"))}
            disabled={busy}
          >
            {detail ? (showDetail ? "Hide detail" : "Review") : "Reject"}
          </Button>
          {detail ? (
            <Button variant="ghost" onClick={() => decide("reject")} disabled={busy}>
              Reject
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
