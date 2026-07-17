"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ScheduleWindowForm({ startHour, endHour }: { startHour: number; endHour: number }) {
  const router = useRouter();
  const [start, setStart] = React.useState(startHour);
  const [end, setEnd] = React.useState(endHour);
  const [saved, setSaved] = React.useState(false);

  async function save() {
    await fetch("/api/admin/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_schedule_window", startHour: start, endHour: end }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  return (
    <div className="flex items-end gap-3">
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-muted">Overnight window, UTC</div>
        <div className="flex items-center gap-2">
          <select value={start} onChange={(e) => setStart(Number(e.target.value))} className="rounded-input border border-line bg-bg px-2.5 py-[6px] text-[12px] text-fg">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
            ))}
          </select>
          <span className="text-[11px] text-muted">to</span>
          <select value={end} onChange={(e) => setEnd(Number(e.target.value))} className="rounded-input border border-line bg-bg px-2.5 py-[6px] text-[12px] text-fg">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
            ))}
          </select>
        </div>
      </div>
      <Button variant="secondary" onClick={save}>
        {saved ? "Saved" : "Set window"}
      </Button>
      <p className="text-[10.5px] text-faint">
        Runs stagger across this window, capped in parallel, to share the box with Tess Console&apos;s
        nightly renders.
      </p>
    </div>
  );
}

export function SourceRow(props: {
  id: string;
  name: string;
  countryCode: string;
  type: string;
  enabled: boolean;
  proxyEnabled: boolean;
  lastStatus: string | null;
  lastFetched: number | null;
  lastRanAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function op(o: "enable" | "disable" | "proxy_on" | "proxy_off") {
    setBusy(true);
    await fetch("/api/admin/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "source", sourceId: props.id, op: o }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 border-t border-line px-cardpad py-rowpad">
      <span className="w-8 shrink-0 font-mono text-[10px] text-faint">{props.countryCode}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold">{props.name}</div>
        <div className="font-mono text-[10px] text-faint">{props.type}</div>
      </div>
      {props.lastStatus ? (
        <span
          className={cn(
            "rounded-pill px-[8px] py-[2.5px] font-mono text-[10px]",
            props.lastStatus === "success" ? "bg-jade-dim text-jade" : "bg-red-dim text-red",
          )}
          title={props.lastRanAt ?? ""}
        >
          {props.lastStatus === "success" ? `${props.lastFetched ?? 0} jobs` : "failed"}
        </span>
      ) : (
        <span className="rounded-pill bg-track px-[8px] py-[2.5px] font-mono text-[10px] text-faint">not run</span>
      )}
      <button
        type="button"
        onClick={() => op(props.proxyEnabled ? "proxy_off" : "proxy_on")}
        disabled={busy}
        className={cn(
          "rounded-pill border px-[10px] py-[4px] text-[10px] font-semibold",
          props.proxyEnabled ? "border-jade-line bg-jade-dim text-jade" : "border-line text-muted hover:bg-raised",
        )}
      >
        proxy {props.proxyEnabled ? "on" : "off"}
      </button>
      <Button variant="ghost" onClick={() => op(props.enabled ? "disable" : "enable")} disabled={busy}>
        {props.enabled ? "Enabled" : "Disabled"}
      </Button>
    </div>
  );
}
