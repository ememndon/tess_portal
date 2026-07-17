"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * On-demand triggers for the ops tasks. These publish a run-now request
 * to the same scheduler channel the Jobs Monitor uses; results land in
 * task_runs and the cards above refresh a few seconds later.
 */

const TASKS = [
  { id: "health.deliverability", label: "Check deliverability now" },
] as const;

export function OpsTriggers() {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  async function run(taskId: string, label: string) {
    setBusy(taskId);
    setNote(null);
    const res = await fetch("/api/admin/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "task", taskId, op: "run" }),
    });
    setBusy(null);
    if (res.ok) {
      setNote(`${label} started. It runs in the background, refreshing in a few seconds.`);
      setTimeout(() => router.refresh(), 6000);
    } else {
      const p = (await res.json().catch(() => ({}))) as { error?: string };
      setNote(p.error ?? "could not start the task");
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {TASKS.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={busy !== null}
          onClick={() => run(t.id, t.label)}
          className="rounded-pill border border-line px-[11px] py-[5px] text-[11px] font-semibold text-muted hover:bg-raised disabled:opacity-60"
        >
          {busy === t.id ? "Starting" : t.label}
        </button>
      ))}
      {note ? <span className="w-full font-mono text-[10.5px] text-faint">{note}</span> : null}
    </div>
  );
}
