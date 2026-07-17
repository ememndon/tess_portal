"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const LEADS = [
  { minutes: 10080, label: "1 week before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 120, label: "2 hours before" },
  { minutes: 30, label: "30 minutes before" },
];

export function InterviewForm({ jobs }: { jobs: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [leads, setLeads] = React.useState<number[]>([1440, 120]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: data.jobId,
        round: data.round,
        medium: data.medium,
        locationOrLink: data.locationOrLink || undefined,
        localDateTime: data.localDateTime,
        durationMin: data.durationMin,
        reminderLeadMinutes: leads,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not schedule, try again");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Schedule an interview</Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="iv-job">Job</Label>
          <select
            id="iv-job"
            name="jobId"
            required
            className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="iv-round">Round</Label>
          <Input id="iv-round" name="round" defaultValue="Round 1" required />
        </div>
        <div>
          <Label htmlFor="iv-when">Date and time, your timezone</Label>
          <Input id="iv-when" name="localDateTime" type="datetime-local" required />
        </div>
        <div>
          <Label htmlFor="iv-duration">Duration, minutes</Label>
          <Input id="iv-duration" name="durationMin" type="number" defaultValue={60} min={15} max={480} />
        </div>
        <div>
          <Label htmlFor="iv-medium">Medium</Label>
          <select
            id="iv-medium"
            name="medium"
            defaultValue="video"
            className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
          >
            <option value="video">Video</option>
            <option value="phone">Phone</option>
            <option value="onsite">On site</option>
          </select>
        </div>
        <div>
          <Label htmlFor="iv-loc">Link or address</Label>
          <Input id="iv-loc" name="locationOrLink" placeholder="https://meet..." />
        </div>
      </div>
      <div>
        <Label>Email reminders</Label>
        <div className="flex flex-wrap gap-1.5">
          {LEADS.map((l) => {
            const on = leads.includes(l.minutes);
            return (
              <button
                key={l.minutes}
                type="button"
                onClick={() =>
                  setLeads((cur) =>
                    on ? cur.filter((m) => m !== l.minutes) : [...cur, l.minutes],
                  )
                }
                className={cn(
                  "rounded-pill border px-[10px] py-[4px] text-[10.5px] font-semibold",
                  on ? "border-jade-line bg-jade-dim text-jade" : "border-line text-muted hover:bg-raised",
                )}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Scheduling" : "Schedule interview"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type PrepPack = {
  round: string;
  likelyQuestions: { question: string; why: string; drawOn: string }[];
  companyTalkingPoints: string[];
  yourStories: { title: string; competency: string }[];
  yourProjects: string[];
  reminders: string[];
  generatedAt: string;
  model: string | null;
};

function PrepPackView({ pack }: { pack: PrepPack }) {
  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-[10px] border border-line bg-bg p-3">
      <div>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">Likely questions</p>
        <ul className="mt-1 flex flex-col gap-1.5">
          {pack.likelyQuestions.map((q, i) => (
            <li key={i} className="text-[12px]">
              <span className="font-semibold">{q.question}</span>
              <span className="text-faint"> — {q.why}</span>
              <div className="font-mono text-[10px] text-jade">draw on: {q.drawOn}</div>
            </li>
          ))}
        </ul>
      </div>
      {pack.companyTalkingPoints.length > 0 ? (
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">Talking points</p>
          <ul className="mt-1 list-disc pl-4 text-[11.5px] text-muted">
            {pack.companyTalkingPoints.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {pack.reminders.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {pack.reminders.map((r, i) => (
            <span key={i} className="rounded-pill bg-track px-[8px] py-[2.5px] text-[10px] text-faint">
              {r}
            </span>
          ))}
        </div>
      ) : null}
      <p className="font-mono text-[9.5px] text-faint">
        {pack.model ? `by ${pack.model}` : "standard set, no model"} · {new Date(pack.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}

export function InterviewRow(props: {
  id: string;
  round: string;
  medium: string;
  outcome: string | null;
  jobLabel: string;
  localTime: string;
  upcoming: boolean;
  prepPack: PrepPack | null;
}) {
  const router = useRouter();
  const [pack, setPack] = React.useState<PrepPack | null>(props.prepPack);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  async function remove() {
    await fetch("/api/interviews", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: props.id }),
    });
    router.refresh();
  }
  async function setOutcome(outcome: string) {
    await fetch("/api/interviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: props.id, outcome: outcome || null }),
    });
    router.refresh();
  }
  async function regenerate() {
    setBusy(true);
    const res = await fetch(`/api/interviews/${props.id}/prep`, { method: "POST" });
    const payload = (await res.json().catch(() => ({}))) as { pack?: PrepPack };
    setBusy(false);
    if (payload.pack) {
      setPack(payload.pack);
      setOpen(true);
    }
  }
  return (
    <div className="border-t border-line px-cardpad py-rowpad">
      <div className="flex items-center gap-3">
        <span className="min-w-[120px] rounded-[8px] bg-jade-dim px-2 py-1 text-center font-mono text-[10.5px] text-jade">
          {props.localTime}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold">{props.jobLabel}</div>
          <div className="text-[11px] text-muted">
            {props.round} · {props.medium}
          </div>
        </div>
        {props.upcoming ? (
          <span className="rounded-pill bg-jade-dim px-[8px] py-[2.5px] text-[10px] font-semibold text-jade">
            upcoming
          </span>
        ) : (
          <select
            value={props.outcome ?? ""}
            onChange={(e) => setOutcome(e.target.value)}
            className="rounded-input border border-line bg-bg px-2 py-[4px] text-[11px] text-muted"
          >
            <option value="">Outcome?</option>
            <option value="passed">Passed</option>
            <option value="failed">Did not pass</option>
            <option value="waiting">Waiting to hear</option>
          </select>
        )}
        <button type="button" onClick={remove} className="text-[11px] text-faint hover:text-red">
          Delete
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        {pack ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="font-mono text-[10px] text-jade hover:underline">
            {open ? "Hide prep pack" : "Prep pack ready"}
          </button>
        ) : (
          <span className="font-mono text-[10px] text-faint">
            {busy ? "Building prep pack" : "No prep pack yet"}
          </span>
        )}
        <button type="button" onClick={regenerate} disabled={busy} className="font-mono text-[10px] text-faint hover:text-jade disabled:opacity-60">
          {busy ? "…" : pack ? "regenerate" : "generate now"}
        </button>
      </div>
      {pack && open ? <PrepPackView pack={pack} /> : null}
    </div>
  );
}

export function OfferForm({ jobs }: { jobs: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    const res = await fetch("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: data.jobId,
        baseSalary: data.baseSalary || undefined,
        currency: data.currency.toUpperCase(),
        period: data.period,
        bonus: data.bonus || undefined,
        equity: data.equity || undefined,
        benefits: data.benefits || undefined,
        relocation: data.relocation || undefined,
        deadline: data.deadline || undefined,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not record the offer");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) return <Button onClick={() => setOpen(true)}>Record an offer</Button>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3">
          <Label htmlFor="of-job">Job</Label>
          <select
            id="of-job"
            name="jobId"
            required
            className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="of-base">Base salary</Label>
          <Input id="of-base" name="baseSalary" inputMode="numeric" placeholder="72000" />
        </div>
        <div>
          <Label htmlFor="of-currency">Currency</Label>
          <Input id="of-currency" name="currency" defaultValue="EUR" maxLength={3} required />
        </div>
        <div>
          <Label htmlFor="of-period">Period</Label>
          <select
            id="of-period"
            name="period"
            defaultValue="year"
            className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
          >
            <option value="year">Per year</option>
            <option value="month">Per month</option>
            <option value="day">Per day</option>
            <option value="hour">Per hour</option>
          </select>
        </div>
        <div>
          <Label htmlFor="of-bonus">Bonus</Label>
          <Input id="of-bonus" name="bonus" placeholder="10%" />
        </div>
        <div>
          <Label htmlFor="of-equity">Equity</Label>
          <Input id="of-equity" name="equity" />
        </div>
        <div>
          <Label htmlFor="of-deadline">Decision deadline</Label>
          <Input id="of-deadline" name="deadline" type="date" />
        </div>
        <div className="col-span-3">
          <Label htmlFor="of-benefits">Benefits</Label>
          <Input id="of-benefits" name="benefits" placeholder="Pension, health, relocation package" />
        </div>
        <div className="col-span-3">
          <Label htmlFor="of-relocation">Relocation</Label>
          <Input id="of-relocation" name="relocation" placeholder="Visa + flights + 1 month housing" />
        </div>
      </div>
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving" : "Record offer"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function OfferRow(props: {
  id: string;
  jobLabel: string;
  baseSalary: string | null;
  currency: string;
  period: string;
  bonus: string | null;
  deadline: string | null;
}) {
  const router = useRouter();
  async function remove() {
    await fetch("/api/offers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: props.id }),
    });
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3 border-t border-line px-cardpad py-rowpad">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold">{props.jobLabel}</div>
        <div className="text-[11px] text-muted">{props.bonus ? `bonus ${props.bonus}` : ""}</div>
      </div>
      <span className="font-mono text-[11px] text-fg">
        {props.baseSalary
          ? `${props.currency} ${Number(props.baseSalary).toLocaleString()} / ${props.period}`
          : "terms open"}
      </span>
      {props.deadline ? (
        <span className="rounded-pill bg-track px-[8px] py-[2.5px] font-mono text-[10px] text-faint">
          decide by {props.deadline}
        </span>
      ) : null}
      <button type="button" onClick={remove} className="text-[11px] text-faint hover:text-red">
        Delete
      </button>
    </div>
  );
}
