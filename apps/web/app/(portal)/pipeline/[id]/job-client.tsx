"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { STAGES } from "@/lib/stages";
import { cn } from "@/lib/utils";

export function JobActions({ jobId, currentStage }: { jobId: string; currentStage: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  async function moveTo(stage: string) {
    if (stage === currentStage) return;
    setBusy(true);
    await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    router.push("/pipeline");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STAGES.map((s) => (
        <button
          key={s.key}
          type="button"
          disabled={busy}
          onClick={() => moveTo(s.key)}
          className={cn(
            "rounded-pill border px-[10px] py-[4px] text-[10.5px] font-semibold",
            s.key === currentStage
              ? "border-transparent"
              : "border-line text-muted hover:bg-raised",
          )}
          style={
            s.key === currentStage
              ? { color: s.color, background: `color-mix(in srgb, ${s.color} 12%, transparent)` }
              : undefined
          }
        >
          {s.label}
        </button>
      ))}
      <div className="ml-auto">
        {confirmingDelete ? (
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-muted">Delete this job and its history?</span>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              Delete job
            </Button>
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

export function NoteComposer({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note.trim() }),
    });
    setNote("");
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note to the timeline"
        className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg placeholder:text-faint"
      />
      <Button type="submit" variant="secondary" disabled={busy || !note.trim()}>
        Add note
      </Button>
    </form>
  );
}
