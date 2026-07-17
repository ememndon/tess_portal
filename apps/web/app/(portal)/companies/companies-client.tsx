"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Brief = {
  summary: string;
  stack: string[];
  news: string[];
  funding: string;
  sponsorship: string;
  talkingPoints: string[];
  sources: { label: string; url: string }[];
  generatedAt: string;
  model: string | null;
  note?: string;
};

type Company = {
  id: string;
  name: string;
  website: string | null;
  sponsorStatus: string;
  watched: boolean;
  brief: Brief | null;
};

type Recommendation = {
  companyName: string;
  countryCode: string | null;
  roleCount: number;
  matchScore: number;
  sponsorship: string;
  sampleTitle: string;
  reasons: string[];
  score: number;
};

type Signal = {
  id: string;
  companyName: string;
  type: string;
  payload: Record<string, unknown> | null;
  detectedAt: string;
};

function BriefView({ brief }: { brief: Brief }) {
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-[10px] border border-line bg-bg p-3">
      <p className="text-[12px] text-fg">{brief.summary}</p>
      {brief.talkingPoints.length > 0 ? (
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">Talking points</p>
          <ul className="mt-1 list-disc pl-4 text-[11.5px] text-muted">
            {brief.talkingPoints.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3 text-[11px] text-muted">
        {brief.stack.length > 0 ? (
          <span>
            <span className="text-faint">Stack:</span> {brief.stack.join(", ")}
          </span>
        ) : null}
        <span>
          <span className="text-faint">Funding:</span> {brief.funding}
        </span>
      </div>
      <p className="text-[11px] text-muted">{brief.sponsorship}</p>
      {brief.news.length > 0 ? (
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">Recent</p>
          <ul className="mt-1 list-disc pl-4 text-[11.5px] text-muted">
            {brief.news.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">Sources</p>
        {brief.sources.length === 0 ? (
          <p className="text-[11px] text-faint">No source pages were readable.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {brief.sources.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-pill border border-line px-[8px] py-[2.5px] font-mono text-[10px] text-faint hover:border-jade-line hover:text-jade"
              >
                {s.label}
              </a>
            ))}
          </div>
        )}
      </div>
      {brief.note ? <p className="text-[10.5px] text-amber">{brief.note}</p> : null}
      <p className="font-mono text-[9.5px] text-faint">
        {brief.model ? `synthesized by ${brief.model}` : "no model, sources only"} ·{" "}
        {new Date(brief.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}

function CompanyRow({ company }: { company: Company }) {
  const router = useRouter();
  const [brief, setBrief] = React.useState<Brief | null>(company.brief);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function act(action: "watch" | "unwatch" | "delete") {
    await fetch("/api/companies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: company.id, action }),
    });
    router.refresh();
  }

  async function research() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/companies/${company.id}/brief`, { method: "POST" });
    const payload = (await res.json().catch(() => ({}))) as { brief?: Brief; error?: string };
    setBusy(false);
    if (!res.ok || !payload.brief) {
      setError(payload.error ?? "could not build a brief");
      return;
    }
    setBrief(payload.brief);
    setOpen(true);
  }

  return (
    <div className="border-t border-line px-cardpad py-rowpad">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold">{company.name}</div>
          {company.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10.5px] text-faint hover:text-jade"
            >
              {company.website}
            </a>
          ) : null}
        </div>
        <span className="rounded-pill bg-track px-[8px] py-[2.5px] font-mono text-[10px] text-faint">
          sponsor {company.sponsorStatus}
        </span>
        <button
          type="button"
          onClick={research}
          disabled={busy}
          className="rounded-pill border border-line px-[10px] py-[4px] text-[10.5px] font-semibold text-muted hover:bg-raised disabled:opacity-60"
        >
          {busy ? "Researching" : brief ? "Refresh brief" : "Research"}
        </button>
        <button
          type="button"
          onClick={() => act(company.watched ? "unwatch" : "watch")}
          className={cn(
            "rounded-pill border px-[10px] py-[4px] text-[10.5px] font-semibold",
            company.watched
              ? "border-jade-line bg-jade-dim text-jade"
              : "border-line text-muted hover:bg-raised",
          )}
        >
          {company.watched ? "Watching" : "Watch"}
        </button>
        <button
          type="button"
          onClick={() => act("delete")}
          title="Stop tracking and remove this company"
          className="rounded-pill border border-line px-[10px] py-[4px] text-[10.5px] font-semibold text-muted hover:border-red hover:text-red"
        >
          Delete
        </button>
      </div>
      {error ? <p className="mt-1 text-[11px] text-red">{error}</p> : null}
      {brief ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1.5 font-mono text-[10px] text-jade hover:underline"
        >
          {open ? "Hide brief" : "Show brief"}
        </button>
      ) : null}
      {brief && open ? <BriefView brief={brief} /> : null}
    </div>
  );
}

export function CompaniesClient({
  companies,
  recommendations,
  signals,
}: {
  companies: Company[];
  recommendations: Recommendation[];
  signals: Signal[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, website: website || "" }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not add the company");
      return;
    }
    setName("");
    setWebsite("");
    router.refresh();
  }

  async function addFromRec(rec: Recommendation) {
    await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: rec.companyName, website: "" }),
    });
    router.refresh();
  }

  async function notInterested(rec: Recommendation) {
    await fetch("/api/companies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName: rec.companyName, action: "not-interested" }),
    });
    router.refresh();
  }

  return (
    <div className="mt-gap columns-1 [column-gap:var(--gap)] @4xl:columns-2 [&>*]:mb-gap [&>*]:break-inside-avoid">
      {recommendations.length > 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between p-cardpad pb-2.5">
            <h2 className="font-disp text-[13.5px] font-bold">Recommended for you</h2>
            <span className="font-mono text-[10px] text-faint">suggestions from your jobs</span>
          </div>
          {recommendations.map((rec) => (
            <div key={rec.companyName} className="flex items-center gap-3 border-t border-line px-cardpad py-rowpad">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold">{rec.companyName}</div>
                <div className="text-[11px] text-muted">{rec.reasons.join(" · ")}</div>
              </div>
              <span className="font-mono text-[10px] text-faint">{rec.roleCount} role{rec.roleCount === 1 ? "" : "s"}</span>
              <button
                type="button"
                onClick={() => addFromRec(rec)}
                className="rounded-pill border border-jade-line bg-jade-dim px-[10px] py-[4px] text-[10.5px] font-semibold text-jade"
              >
                Track
              </button>
              <button
                type="button"
                onClick={() => notInterested(rec)}
                title="Hide this suggestion and dismiss its roles"
                className="rounded-pill border border-line px-[10px] py-[4px] text-[10.5px] font-semibold text-muted hover:border-red hover:text-red"
              >
                Not interested
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-card border border-line bg-surface">
        <form onSubmit={add} className="flex flex-wrap gap-2 p-cardpad">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" className="max-w-[220px]" required />
          <Input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            type="url"
            placeholder="https://company.com"
            className="max-w-[260px]"
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            Add company
          </Button>
          {error ? <p className="w-full text-[11.5px] text-red">{error}</p> : null}
        </form>
        {companies.length === 0 ? (
          <div className="border-t border-line px-cardpad py-rowpad text-[12px] text-muted">Nothing tracked yet.</div>
        ) : (
          companies.map((c) => <CompanyRow key={c.id} company={c} />)
        )}
      </div>

      {signals.length > 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between p-cardpad pb-2.5">
            <h2 className="font-disp text-[13.5px] font-bold">Hiring signals</h2>
            <span className="font-mono text-[10px] text-faint">watched companies</span>
          </div>
          {signals.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-t border-line px-cardpad py-rowpad">
              <span className="min-w-[92px] font-mono text-[10px] text-faint">{s.detectedAt}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px]">
                  <span className="font-semibold">{s.companyName}</span>{" "}
                  <span className="text-muted">
                    {s.type === "new_posting"
                      ? `posted: ${String((s.payload?.title as string) ?? "a new role")}`
                      : s.type === "news_update"
                        ? "news or press update"
                        : s.type}
                  </span>
                </div>
              </div>
              {s.payload?.url ? (
                <a
                  href={String(s.payload.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-jade hover:underline"
                >
                  open
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
