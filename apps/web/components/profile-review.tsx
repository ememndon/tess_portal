"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Profile } from "@/lib/cv/schema";

/**
 * The mandatory profile review and confirm editor. The user checks and
 * corrects every field the LLM extracted before confirming. Nothing
 * downstream trusts the profile until it is confirmed here.
 */

function Field({ label, value, onChange, textarea }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
        />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function ProfileReview({
  initial,
  onConfirmed,
  confirmLabel = "Confirm profile",
}: {
  initial: Profile;
  onConfirmed?: () => void;
  confirmLabel?: string;
}) {
  const [p, setP] = React.useState<Profile>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setP((cur) => ({ ...cur, [key]: value }));

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/cv/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "could not confirm, try again");
      return;
    }
    setDone(true);
    onConfirmed?.();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[10px] border border-amber/40 bg-[color-mix(in_srgb,var(--amber)_8%,transparent)] px-3 py-2 text-[11.5px] text-amber">
        Check every field. Tess only uses what you confirm here, and a tailored CV can never claim
        anything you have not confirmed.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" value={p.name} onChange={(v) => set("name", v)} />
        <Field label="Headline" value={p.headline} onChange={(v) => set("headline", v)} />
        <Field label="Email" value={p.email} onChange={(v) => set("email", v)} />
        <Field label="Phone" value={p.phone} onChange={(v) => set("phone", v)} />
        <Field label="Location" value={p.location} onChange={(v) => set("location", v)} />
        <Field label="Links (comma separated)" value={p.links.join(", ")} onChange={(v) => set("links", v.split(",").map((s) => s.trim()).filter(Boolean))} />
      </div>
      <Field label="Summary" value={p.summary} onChange={(v) => set("summary", v)} textarea />
      <Field label="Skills (comma separated)" value={p.skills.join(", ")} onChange={(v) => set("skills", v.split(",").map((s) => s.trim()).filter(Boolean))} textarea />
      <Field label="Your work style (for culture-fit scoring)" value={p.workStyle} onChange={(v) => set("workStyle", v)} textarea />

      <ArraySection
        title="Experience"
        items={p.experience}
        onChange={(v) => set("experience", v)}
        empty={{ company: "", role: "", location: "", start: "", end: "", current: false, bullets: [] }}
        render={(item, update) => (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Input value={item.role} onChange={(e) => update({ ...item, role: e.target.value })} placeholder="Role" />
              <Input value={item.company} onChange={(e) => update({ ...item, company: e.target.value })} placeholder="Company" />
              <Input value={item.start} onChange={(e) => update({ ...item, start: e.target.value })} placeholder="Start (2021)" />
              <Input value={item.end} onChange={(e) => update({ ...item, end: e.target.value })} placeholder="End (2024 or Present)" />
            </div>
            <textarea
              value={item.bullets.join("\n")}
              onChange={(e) => update({ ...item, bullets: e.target.value.split("\n").map((b) => b.trim()).filter(Boolean) })}
              rows={3}
              placeholder="One achievement per line"
              className="mt-2 w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12px] text-fg"
            />
          </>
        )}
      />

      <ArraySection
        title="Education"
        items={p.education}
        onChange={(v) => set("education", v)}
        empty={{ institution: "", degree: "", field: "", start: "", end: "" }}
        render={(item, update) => (
          <div className="grid grid-cols-2 gap-2">
            <Input value={item.degree} onChange={(e) => update({ ...item, degree: e.target.value })} placeholder="Degree" />
            <Input value={item.field} onChange={(e) => update({ ...item, field: e.target.value })} placeholder="Field" />
            <Input value={item.institution} onChange={(e) => update({ ...item, institution: e.target.value })} placeholder="Institution" />
            <Input value={item.end} onChange={(e) => update({ ...item, end: e.target.value })} placeholder="Year" />
          </div>
        )}
      />

      <ArraySection
        title="Projects"
        items={p.projects}
        onChange={(v) => set("projects", v)}
        empty={{ name: "", description: "", url: "", tech: [] }}
        render={(item, update) => (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Input value={item.name} onChange={(e) => update({ ...item, name: e.target.value })} placeholder="Name" />
              <Input value={item.url} onChange={(e) => update({ ...item, url: e.target.value })} placeholder="URL" />
            </div>
            <Input className="mt-2" value={item.tech.join(", ")} onChange={(e) => update({ ...item, tech: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Tech (comma separated)" />
            <textarea value={item.description} onChange={(e) => update({ ...item, description: e.target.value })} rows={2} placeholder="Description" className="mt-2 w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12px] text-fg" />
          </>
        )}
      />

      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      {done ? <p className="text-[11.5px] text-jade">Profile confirmed. Tess is ready to tailor.</p> : null}
      <div>
        <Button onClick={confirm} disabled={busy || !p.name.trim()}>
          {busy ? "Confirming" : done ? "Confirmed" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

function ArraySection<T>({
  title,
  items,
  onChange,
  empty,
  render,
}: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  empty: T;
  render: (item: T, update: (next: T) => void) => React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center">
        <Label>{title}</Label>
        <button
          type="button"
          onClick={() => onChange([...items, structuredClone(empty)])}
          className="ml-auto text-[11px] font-semibold text-jade"
        >
          Add
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-[10px] border border-line bg-surface p-2.5">
            {render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="mt-1.5 text-[11px] text-faint hover:text-red"
            >
              Remove
            </button>
          </div>
        ))}
        {items.length === 0 ? <p className="text-[11.5px] text-faint">None yet.</p> : null}
      </div>
    </div>
  );
}
