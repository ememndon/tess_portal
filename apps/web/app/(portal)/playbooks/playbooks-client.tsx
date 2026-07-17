"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Step = { instruction: string; mode: "auto" | "ask_first" };
type Run = {
  id: string;
  status: string;
  startedAt: string;
  stepLog: { position: number; instruction: string; mode: string; status: string; resultSummary?: string }[];
};
type Playbook = {
  id: string;
  title: string;
  trigger: string;
  category: string | null;
  builtin: boolean;
  steps: Step[];
  runs: Run[];
};

const RUN_COLORS: Record<string, string> = {
  completed: "bg-jade-dim text-jade",
  running: "bg-jade-dim text-jade",
  waiting_approval: "bg-track text-amber",
  paused: "bg-track text-faint",
  failed: "bg-red-dim text-red",
};

function Editor({ playbook, onClose }: { playbook: Playbook | null; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = React.useState(playbook?.title ?? "");
  const [trigger, setTrigger] = React.useState(playbook?.trigger ?? "");
  const [category, setCategory] = React.useState(playbook?.category ?? "");
  const [steps, setSteps] = React.useState<Step[]>(
    playbook?.steps ?? [{ instruction: "", mode: "ask_first" }],
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/playbooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: playbook?.id,
        title,
        trigger,
        category: category || undefined,
        steps: steps.filter((s) => s.instruction.trim().length >= 3),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not save");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-jade-line bg-surface p-cardpad">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label>Category</Label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="applications" />
        </div>
      </div>
      <div>
        <Label>Trigger, when should this run</Label>
        <Input value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="When I say prepare an application" />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Steps, in order</Label>
        {steps.map((s, i) => (
          <div key={i} className="flex gap-2">
            <span className="mt-2 w-4 font-mono text-[10px] text-faint">{i + 1}</span>
            <Input
              value={s.instruction}
              onChange={(e) =>
                setSteps((cur) => cur.map((x, j) => (j === i ? { ...x, instruction: e.target.value } : x)))
              }
              placeholder="What Tess should do"
            />
            <button
              type="button"
              onClick={() =>
                setSteps((cur) =>
                  cur.map((x, j) => (j === i ? { ...x, mode: x.mode === "auto" ? "ask_first" : "auto" } : x)),
                )
              }
              className={cn(
                "shrink-0 rounded-pill border px-[10px] text-[10px] font-semibold",
                s.mode === "auto" ? "border-jade-line bg-jade-dim text-jade" : "border-line bg-track text-amber",
              )}
              title="Flip between Tess may do alone and Tess must ask first"
            >
              {s.mode === "auto" ? "Tess may do alone" : "Tess must ask first"}
            </button>
            <button
              type="button"
              onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))}
              className="text-[11px] text-faint hover:text-red"
              disabled={steps.length === 1}
            >
              ×
            </button>
          </div>
        ))}
        <div>
          <Button variant="secondary" onClick={() => setSteps((cur) => [...cur, { instruction: "", mode: "ask_first" }])}>
            Add step
          </Button>
        </div>
      </div>
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || !title.trim()}>
          Save playbook
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function PlaybooksClient({ playbooks }: { playbooks: Playbook[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Playbook | null | "new">(null);
  const [query, setQuery] = React.useState("");
  const [openRuns, setOpenRuns] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const filtered = playbooks.filter(
    (p) =>
      !query ||
      p.title.toLowerCase().includes(query.toLowerCase()) ||
      (p.category ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  async function run(id: string) {
    setNotice(null);
    const res = await fetch("/api/playbooks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setNotice(res.ok ? "Run started. Watch its history below." : payload.error ?? "could not start the run");
    setTimeout(() => router.refresh(), 800);
  }

  async function remove(id: string) {
    await fetch("/api/playbooks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <div className="flex flex-col gap-gap">
        <div className="flex items-center gap-3">
          <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">Playbooks</h1>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search playbooks"
            className="max-w-[220px]"
          />
          <div className="ml-auto">
            <Button onClick={() => setEditing("new")}>Create a playbook</Button>
          </div>
        </div>
        <p className="text-[11.5px] text-muted">
          Written procedures Tess follows step by step. Every step is flagged, Tess may do alone or
          Tess must ask first. Ask-first steps wait in approvals.
        </p>
        {notice ? <p className="text-[11.5px] text-jade">{notice}</p> : null}

        {editing ? <Editor playbook={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      </div>

      <div className="mt-gap columns-1 [column-gap:var(--gap)] @4xl:columns-2 [&>*]:mb-gap [&>*]:break-inside-avoid">
      {filtered.map((p) => (
        <div key={p.id} className="rounded-card border border-line bg-surface">
          <div className="flex items-center gap-2 p-cardpad pb-2.5">
            <h2 className="font-disp text-[13.5px] font-bold">{p.title}</h2>
            {p.category ? (
              <span className="rounded-pill bg-track px-[8px] py-[2.5px] font-mono text-[10px] text-faint">{p.category}</span>
            ) : null}
            {p.builtin ? (
              <span className="rounded-pill bg-jade-dim px-[8px] py-[2.5px] font-mono text-[10px] text-jade">built in</span>
            ) : null}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(p)}>
                Edit
              </Button>
              <Button onClick={() => run(p.id)}>Run now</Button>
              {!p.builtin ? (
                <Button variant="ghost" onClick={() => remove(p.id)}>
                  Delete
                </Button>
              ) : null}
            </div>
          </div>
          {p.trigger ? (
            <div className="border-t border-line px-cardpad py-2 text-[11.5px] text-muted">Trigger: {p.trigger}</div>
          ) : null}
          {p.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 border-t border-line px-cardpad py-rowpad">
              <span className="w-4 font-mono text-[10px] text-faint">{i + 1}</span>
              <span className="min-w-0 flex-1 text-[12px]">{s.instruction}</span>
              <span
                className={cn(
                  "shrink-0 rounded-pill px-[8px] py-[2.5px] text-[10px] font-semibold",
                  s.mode === "auto" ? "bg-jade-dim text-jade" : "bg-track text-amber",
                )}
              >
                {s.mode === "auto" ? "Tess may do alone" : "Tess must ask first"}
              </span>
            </div>
          ))}
          {p.runs.length > 0 ? (
            <div className="border-t border-line px-cardpad py-2">
              <button
                type="button"
                onClick={() => setOpenRuns(openRuns === p.id ? null : p.id)}
                className="text-[11.5px] font-semibold text-jade"
              >
                Run history ({p.runs.length})
              </button>
              {openRuns === p.id
                ? p.runs.map((r) => (
                    <div key={r.id} className="mt-2 rounded-[10px] bg-bg p-2.5">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded-pill px-[8px] py-[2.5px] font-mono text-[10px]", RUN_COLORS[r.status] ?? "bg-track text-faint")}>
                          {r.status.replace("_", " ")}
                        </span>
                        <span className="font-mono text-[10px] text-faint">{r.startedAt.slice(0, 16).replace("T", " ")}</span>
                      </div>
                      {r.stepLog.map((s) => (
                        <div key={s.position} className="mt-1.5 flex items-start gap-2 text-[11.5px]">
                          <span className="w-4 shrink-0 font-mono text-[10px] text-faint">{s.position + 1}</span>
                          <span
                            className={cn(
                              "shrink-0 rounded-pill px-[7px] py-px font-mono text-[9.5px]",
                              s.status === "done"
                                ? "bg-jade-dim text-jade"
                                : s.status === "waiting_approval"
                                  ? "bg-track text-amber"
                                  : s.status === "failed"
                                    ? "bg-red-dim text-red"
                                    : "bg-track text-faint",
                            )}
                          >
                            {s.status.replace("_", " ")}
                          </span>
                          <span className="min-w-0 flex-1 text-muted">
                            {s.instruction}
                            {s.resultSummary ? <span className="block text-faint">{s.resultSummary}</span> : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      ))}
      </div>
    </div>
  );
}
