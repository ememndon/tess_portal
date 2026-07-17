"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TaskRow(props: {
  id: string;
  name: string;
  schedule: string;
  critical: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastResult: string | null;
  lastDurationMs: number | null;
  successRate: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function op(action: "pause" | "resume" | "run") {
    setBusy(true);
    await fetch("/api/admin/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "task", taskId: props.id, op: action }),
    });
    setBusy(false);
    setTimeout(() => router.refresh(), action === "run" ? 1200 : 100);
  }

  return (
    <div className="border-t border-line px-cardpad py-rowpad">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold">{props.name}</span>
            {props.critical ? (
              <span className="rounded-pill bg-jade-dim px-[7px] py-px font-mono text-[9.5px] text-jade" title="Critical tasks cannot be switched off">
                critical
              </span>
            ) : null}
            {!props.enabled ? (
              <span className="rounded-pill bg-track px-[7px] py-px font-mono text-[9.5px] text-amber">paused</span>
            ) : null}
          </div>
          <div className="font-mono text-[10px] text-faint">{props.id}</div>
        </div>
        <span className="font-mono text-[10.5px] text-faint">{props.schedule}</span>
        <span
          className={cn(
            "rounded-pill px-[8px] py-[2.5px] font-mono text-[10px]",
            props.lastStatus === "success"
              ? "bg-jade-dim text-jade"
              : props.lastStatus === "failed"
                ? "bg-red-dim text-red"
                : "bg-track text-faint",
          )}
        >
          {props.lastStatus ?? "not yet run"}
        </span>
        <span className="w-[90px] text-right font-mono text-[10px] text-faint">
          {props.lastRunAt ? props.lastRunAt.slice(11, 19) + " UTC" : ""}
        </span>
        <span className="w-[60px] text-right font-mono text-[10px] text-faint">
          {props.lastDurationMs !== null ? `${props.lastDurationMs}ms` : ""}
        </span>
        <span className="w-[50px] text-right font-mono text-[10px] text-faint">
          {props.successRate !== null ? `${props.successRate}%` : ""}
        </span>
        <Button variant="secondary" onClick={() => op("run")} disabled={busy}>
          Run now
        </Button>
        <Button
          variant="ghost"
          onClick={() => op(props.enabled ? "pause" : "resume")}
          disabled={busy || props.critical}
          title={props.critical ? "Critical tasks cannot be switched off" : undefined}
        >
          {props.enabled ? "Pause" : "Resume"}
        </Button>
      </div>
      {props.lastResult ? (
        <div className="mt-1.5 rounded-[7px] bg-track/40 px-2.5 py-1 font-mono text-[10.5px] text-muted" style={{ background: "color-mix(in srgb, var(--track) 55%, transparent)" }}>
          {props.lastResult}
        </div>
      ) : null}
    </div>
  );
}
