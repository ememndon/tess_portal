"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Story = {
  id: string;
  title: string;
  competency: string;
  situation: string | null;
  task: string | null;
  action: string | null;
  result: string | null;
};

const COMPETENCIES = [
  "Leadership",
  "Conflict",
  "Ownership",
  "Failure",
  "Impact",
  "Collaboration",
  "Ambiguity",
  "Technical depth",
];

function StoryForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    const res = await fetch("/api/stories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.title,
        competency: data.competency,
        situation: data.situation || undefined,
        task: data.task || undefined,
        action: data.action || undefined,
        result: data.result || undefined,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not save the story");
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="st-title">Title</Label>
          <Input id="st-title" name="title" placeholder="Rescued the payments migration" required />
        </div>
        <div>
          <Label htmlFor="st-comp">Competency</Label>
          <input
            id="st-comp"
            name="competency"
            list="competency-list"
            required
            className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
          />
          <datalist id="competency-list">
            {COMPETENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>
      {(["situation", "task", "action", "result"] as const).map((f) => (
        <div key={f}>
          <Label htmlFor={`st-${f}`} className="capitalize">
            {f}
          </Label>
          <textarea
            id={`st-${f}`}
            name={f}
            rows={2}
            className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
          />
        </div>
      ))}
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving" : "Save story"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StoryCard({ story }: { story: Story }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  async function remove() {
    await fetch("/api/stories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: story.id }),
    });
    router.refresh();
  }
  return (
    <div className="border-t border-line px-cardpad py-rowpad">
      <div className="flex items-center gap-3">
        <span className="rounded-pill bg-jade-dim px-[8px] py-[2.5px] text-[10px] font-semibold text-jade">
          {story.competency}
        </span>
        <div className="min-w-0 flex-1 text-[12.5px] font-semibold">{story.title}</div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="font-mono text-[10px] text-faint hover:text-jade">
          {open ? "hide" : "show"}
        </button>
        <button type="button" onClick={remove} className="text-[11px] text-faint hover:text-red">
          Delete
        </button>
      </div>
      {open ? (
        <dl className="mt-2 flex flex-col gap-1.5 rounded-[10px] border border-line bg-bg p-3 text-[11.5px]">
          {(["situation", "task", "action", "result"] as const).map((f) =>
            story[f] ? (
              <div key={f}>
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">{f}</dt>
                <dd className="text-muted">{story[f]}</dd>
              </div>
            ) : null,
          )}
        </dl>
      ) : null}
    </div>
  );
}

export function StoryBank({ stories }: { stories: Story[] }) {
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between p-cardpad pb-2.5">
        <div>
          <h2 className="font-disp text-[13.5px] font-bold">STAR story bank</h2>
          <p className="text-[11px] text-muted">Your lived examples, indexed by competency. Tess pulls these into prep packs and mock interviews.</p>
        </div>
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-pill border border-jade-line bg-jade-dim px-[10px] py-[4px] text-[10.5px] font-semibold text-jade"
          >
            Add story
          </button>
        ) : null}
      </div>
      {adding ? (
        <div className="border-t border-line p-cardpad">
          <StoryForm onDone={() => setAdding(false)} />
        </div>
      ) : null}
      {stories.length === 0 && !adding ? (
        <div className="border-t border-line px-cardpad py-rowpad text-[12px] text-muted">
          No stories yet. Add a few strong examples and they are ready for every interview.
        </div>
      ) : (
        stories.map((s) => <StoryCard key={s.id} story={s} />)
      )}
    </div>
  );
}
