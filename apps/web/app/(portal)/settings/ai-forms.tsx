"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Routing = { activity: string; label: string; provider: string; model: string };
type ModelOption = { provider: string; providerName: string; modelId: string; label: string; free: boolean };

export function ModelRoutingTable({ routing, options }: { routing: Routing[]; options: ModelOption[] }) {
  const router = useRouter();
  const [busyActivity, setBusyActivity] = React.useState<string | null>(null);
  // Per-row save status shown next to the dropdown so the change is
  // visibly confirmed as locked in (the table saves on selection).
  const [status, setStatus] = React.useState<Record<string, "saved" | "error">>({});

  async function set(activity: string, value: string) {
    setBusyActivity(activity);
    setStatus((s) => {
      const next = { ...s };
      delete next[activity];
      return next;
    });
    const [provider, ...rest] = value.split(":");
    try {
      const res = await fetch("/api/admin/platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_routing",
          activity,
          provider,
          model: provider === "auto" ? "auto" : rest.join(":"),
        }),
      });
      setStatus((s) => ({ ...s, [activity]: res.ok ? "saved" : "error" }));
    } catch {
      setStatus((s) => ({ ...s, [activity]: "error" }));
    }
    setBusyActivity(null);
    router.refresh();
  }

  return (
    <div>
      <p className="px-cardpad pb-2.5 text-[11px] text-muted">
        Changes save automatically the moment you pick a model — a{" "}
        <span className="text-jade">Saved ✓</span> appears when each one is locked in.
      </p>
      {routing.map((r) => (
        <div key={r.activity} className="flex items-center gap-3 border-t border-line px-cardpad py-rowpad">
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold">{r.label}</div>
            <div className="font-mono text-[10px] text-faint">{r.activity}</div>
          </div>
          <span className="w-[64px] shrink-0 text-right text-[10.5px] font-medium">
            {busyActivity === r.activity ? (
              <span className="text-faint">Saving…</span>
            ) : status[r.activity] === "saved" ? (
              <span className="text-jade">Saved ✓</span>
            ) : status[r.activity] === "error" ? (
              <span className="text-red">Failed</span>
            ) : null}
          </span>
          <select
            value={r.provider === "auto" ? "auto" : `${r.provider}:${r.model}`}
            onChange={(e) => set(r.activity, e.target.value)}
            disabled={busyActivity === r.activity}
            className="rounded-input border border-line bg-bg px-2.5 py-[5px] text-[11.5px] text-fg"
          >
            <option value="auto">Free-first chain (auto)</option>
            {options.map((o) => (
              <option key={`${o.provider}:${o.modelId}`} value={`${o.provider}:${o.modelId}`}>
                {o.providerName} · {o.label}
                {o.free ? " (free)" : ""}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

export function TessMemoryEditor({
  instructions,
  facts,
}: {
  instructions: { id: string; instruction: string }[];
  facts: Record<string, string>;
}) {
  const router = useRouter();
  const [newInstruction, setNewInstruction] = React.useState("");
  const [factKey, setFactKey] = React.useState("");
  const [factValue, setFactValue] = React.useState("");

  async function call(body: Record<string, unknown>) {
    await fetch("/api/tess/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-muted">
          Standing instructions, rules Tess always obeys
        </div>
        {instructions.map((i) => (
          <div key={i.id} className="flex items-center gap-2 py-1">
            <span className="min-w-0 flex-1 text-[12px]">{i.instruction}</span>
            <button
              type="button"
              onClick={() => call({ action: "delete_instruction", id: i.id })}
              className="text-[11px] text-faint hover:text-red"
            >
              Remove
            </button>
          </div>
        ))}
        <div className="mt-1.5 flex gap-2">
          <Input
            value={newInstruction}
            onChange={(e) => setNewInstruction(e.target.value)}
            placeholder="Always mention my notice period is 30 days"
          />
          <Button
            variant="secondary"
            onClick={async () => {
              await call({ action: "add_instruction", instruction: newInstruction });
              setNewInstruction("");
            }}
            disabled={newInstruction.trim().length < 3}
          >
            Add rule
          </Button>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-medium text-muted">
          Learned profile, facts Tess picked up. Correct or remove anything.
        </div>
        {Object.entries(facts).length === 0 ? (
          <p className="text-[11.5px] text-faint">Nothing learned yet. Facts appear as you talk to Tess.</p>
        ) : (
          Object.entries(facts).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 py-1">
              <span className="shrink-0 rounded-pill bg-track px-[8px] py-[2.5px] font-mono text-[10px] text-faint">{k}</span>
              <span className="min-w-0 flex-1 truncate text-[12px]">{v}</span>
              <button
                type="button"
                onClick={() => call({ action: "set_fact", key: k, value: "" })}
                className="text-[11px] text-faint hover:text-red"
              >
                Remove
              </button>
            </div>
          ))
        )}
        <div className="mt-1.5 flex gap-2">
          <Input value={factKey} onChange={(e) => setFactKey(e.target.value)} placeholder="salary_floor" className="max-w-[160px]" />
          <Input value={factValue} onChange={(e) => setFactValue(e.target.value)} placeholder="EUR 70k gross" />
          <Button
            variant="secondary"
            onClick={async () => {
              await call({ action: "set_fact", key: factKey.trim(), value: factValue });
              setFactKey("");
              setFactValue("");
            }}
            disabled={!factKey.trim() || !factValue.trim()}
          >
            Save fact
          </Button>
        </div>
      </div>
    </div>
  );
}
