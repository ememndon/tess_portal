"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GlobalPauseToggle({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  async function toggle() {
    setBusy(true);
    await fetch("/api/admin/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_pause", paused: !paused }),
    });
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="text-[12.5px] font-semibold">{paused ? "Platform is paused" : "Platform is running"}</div>
        <div className="text-[11px] text-muted">
          Pause halts Tess, playbooks, and every scheduled task. Backups stay exempt.
        </div>
      </div>
      <Button variant={paused ? "primary" : "destructive"} onClick={toggle} disabled={busy}>
        {paused ? "Resume everything" : "Pause everything"}
      </Button>
    </div>
  );
}

export function CapForm({ currentCap }: { currentCap: number }) {
  const router = useRouter();
  const [value, setValue] = React.useState(String(currentCap));
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  async function save() {
    setBusy(true);
    await fetch("/api/admin/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_cap", monthlyCapUsd: Number(value) }),
    });
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }
  return (
    <div className="flex items-end gap-2">
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-muted">Monthly cap, USD</div>
        <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="w-[110px]" />
      </div>
      <Button variant="secondary" onClick={save} disabled={busy || !/^\d+(\.\d+)?$/.test(value)}>
        {saved ? "Saved" : "Set cap"}
      </Button>
    </div>
  );
}

export function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="py-1.5">
      <div className="flex justify-between font-mono text-[10.5px] text-faint">
        <b className="font-medium text-fg">{label}</b>
        <span>
          {used.toLocaleString()} / {limit.toLocaleString()} {unit}
        </span>
      </div>
      <div className="mt-1.5 h-[6px] overflow-hidden rounded-pill bg-track">
        <i
          className="block h-full rounded-pill"
          style={{ width: `${pct}%`, background: pct >= 90 ? "var(--amber)" : "var(--jade)" }}
        />
      </div>
    </div>
  );
}

export function DailyTrendChart({ data }: { data: { day: string; usd: number }[] }) {
  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
          />
          <YAxis
            tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              fontSize: 11,
              color: "var(--text)",
            }}
            formatter={((v: unknown) => [`$${Number(v).toFixed(4)}`, "spend"]) as never}
          />
          <Area type="monotone" dataKey="usd" stroke="var(--jade)" fill="var(--jade)" fillOpacity={0.15} strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
