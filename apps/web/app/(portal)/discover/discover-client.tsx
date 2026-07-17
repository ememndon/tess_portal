"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScoreRing } from "@/components/score-ring";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DiscoverJob = {
  id: string;
  title: string;
  companyName: string;
  location: string | null;
  countryCode: string | null;
  remote: string | null;
  url: string | null;
  source: string;
  salary: string | null;
  sponsorship: string;
  matchScore: number | null;
  matchExplanation: string[];
  signals: { label: string; severity: string }[];
  postedAt: string | null;
};

function freshness(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function SponsorPill({ status }: { status: string }) {
  if (status === "yes")
    return <span className="rounded-pill bg-jade-dim px-[8px] py-[2.5px] text-[10px] font-semibold text-jade">Sponsor confirmed</span>;
  if (status === "inferred")
    return (
      <span className="rounded-pill px-[8px] py-[2.5px] text-[10px] font-semibold text-amber" style={{ background: "color-mix(in srgb, var(--amber) 12%, transparent)" }}>
        Sponsorship inferred
      </span>
    );
  return <span className="rounded-pill bg-track px-[8px] py-[2.5px] text-[10px] font-semibold text-faint">No visa info</span>;
}

/** Previous/Next control, rendered above and below the list so long pages need no scrolling. */
function Pager({
  page,
  pageCount,
  onGo,
}: {
  page: number;
  pageCount: number;
  onGo: (next: number) => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-2">
      <Button variant="secondary" onClick={() => onGo(page - 1)} disabled={page <= 1}>
        Previous
      </Button>
      <span className="font-mono text-[10.5px] text-faint">
        Page {page} of {pageCount}
      </span>
      <Button variant="secondary" onClick={() => onGo(page + 1)} disabled={page >= pageCount}>
        Next
      </Button>
    </div>
  );
}

type Filters = {
  country: string | null;
  source: string | null;
  sponsorship: string | null;
  q: string | null;
  sort: string | null;
};

const COUNTRY_NAMES: Record<string, string> = {
  IE: "Ireland", NL: "Netherlands", NZ: "New Zealand", AU: "Australia", GB: "United Kingdom",
  CA: "Canada", NO: "Norway", AE: "UAE", QA: "Qatar", SA: "Saudi Arabia", US: "United States",
};
const SPONSORSHIP_LABELS: Record<string, string> = {
  yes: "Sponsor confirmed",
  inferred: "Sponsorship likely",
  unknown: "No visa info",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function DiscoverClient({
  jobs,
  hasSupportedCountries,
  reveal,
  gatedCount,
  facets,
  filters,
  page,
  pageCount,
  pageSize,
  total,
}: {
  jobs: DiscoverJob[];
  hasSupportedCountries: boolean;
  reveal: boolean;
  gatedCount: number;
  facets: { countries: string[]; sources: string[] };
  filters: Filters;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [titleQuery, setTitleQuery] = React.useState(filters.q ?? "");

  const anyFilter = Boolean(filters.country || filters.source || filters.sponsorship || filters.q || filters.sort);

  function urlFor(merged: Filters, nextPage: number) {
    const params = new URLSearchParams();
    if (reveal) params.set("all", "1");
    if (merged.country) params.set("country", merged.country);
    if (merged.source) params.set("source", merged.source);
    if (merged.sponsorship) params.set("sponsorship", merged.sponsorship);
    if (merged.q) params.set("q", merged.q);
    if (merged.sort) params.set("sort", merged.sort);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/discover?${qs}` : "/discover";
  }

  /** Changing any filter sends you back to page 1 — page 7 of the old result set is meaningless. */
  function applyFilters(next: Partial<Filters>) {
    setSelected(new Set());
    router.push(urlFor({ ...filters, ...next }, 1));
  }

  function goToPage(nextPage: number) {
    setSelected(new Set());
    setExpanded(null);
    router.push(urlFor(filters, nextPage));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function runNow() {
    setRunning(true);
    setNotice(null);
    const res = await fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setNotice(payload.error ?? "could not start discovery");
      setRunning(false);
      return;
    }
    setNotice("Discovery is running. New matches will appear here in about a minute — reload if needed. (No email; Tess only emails from its own daily search.)");
    // give the worker time, then refresh
    setTimeout(() => {
      router.refresh();
      setRunning(false);
    }, 12000);
  }

  async function act(jobId: string, action: "save" | "dismiss") {
    setPending((p) => new Set(p).add(jobId));
    await fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, jobId }),
    });
    router.refresh();
  }

  function toggleSelect(jobId: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(jobId)) n.delete(jobId);
      else n.add(jobId);
      return n;
    });
  }
  const allSelected = jobs.length > 0 && selected.size === jobs.length;
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(jobs.map((j) => j.id)));
  }
  async function bulkDismiss() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setPending((p) => new Set([...p, ...ids]));
    await fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss-bulk", jobIds: ids }),
    });
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-gap">
      <div className="flex items-center">
        <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">Discover</h1>
        <span className="ml-3 font-mono text-[10.5px] text-faint">
          {total === 0
            ? "0 matches"
            : `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + jobs.length} of ${total} matches`}
        </span>
        <div className="ml-auto">
          <Button onClick={runNow} disabled={running || !hasSupportedCountries}>
            {running ? "Finding jobs" : "Find jobs now"}
          </Button>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface px-cardpad py-2">
        <select
          value={filters.sort ?? ""}
          onChange={(e) => applyFilters({ sort: e.target.value || null })}
          className="h-[30px] rounded-input border border-line bg-bg px-2 text-[12px] text-fg"
          title="Sort matches"
        >
          <option value="">Best match</option>
          <option value="recent">Most recent</option>
        </select>
        <select
          value={filters.country ?? ""}
          onChange={(e) => applyFilters({ country: e.target.value || null })}
          className="h-[30px] rounded-input border border-line bg-bg px-2 text-[12px] text-fg"
        >
          <option value="">All countries</option>
          {facets.countries.map((c) => (
            <option key={c} value={c}>
              {COUNTRY_NAMES[c] ?? c}
            </option>
          ))}
        </select>
        <select
          value={filters.sponsorship ?? ""}
          onChange={(e) => applyFilters({ sponsorship: e.target.value || null })}
          className="h-[30px] rounded-input border border-line bg-bg px-2 text-[12px] text-fg"
        >
          <option value="">Any sponsorship</option>
          <option value="yes">Sponsor confirmed</option>
          <option value="inferred">Sponsorship likely</option>
          <option value="unknown">No visa info</option>
        </select>
        <select
          value={filters.source ?? ""}
          onChange={(e) => applyFilters({ source: e.target.value || null })}
          className="h-[30px] rounded-input border border-line bg-bg px-2 text-[12px] text-fg"
        >
          <option value="">All sources</option>
          {facets.sources.map((s) => (
            <option key={s} value={s}>
              {s === "watch" ? "Watched company" : cap(s)}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <input
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters({ q: titleQuery.trim() || null })}
            placeholder="Filter by job title or company"
            className="h-[30px] w-[220px] rounded-input border border-line bg-bg px-2.5 text-[12px] text-fg placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => applyFilters({ q: titleQuery.trim() || null })}
            className="h-[30px] rounded-input border border-line px-2.5 text-[11.5px] text-muted hover:bg-raised"
          >
            Go
          </button>
        </div>
        {anyFilter ? (
          <button
            type="button"
            onClick={() => {
              setTitleQuery("");
              applyFilters({ country: null, source: null, sponsorship: null, q: null, sort: null });
            }}
            className="text-[11px] font-semibold text-jade"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {!hasSupportedCountries ? (
        <div className="rounded-card border border-line bg-surface px-cardpad py-3 text-[12px] text-muted">
          None of your target countries support automated discovery yet. Add one of the supported
          countries (e.g. Ireland, the Netherlands, New Zealand, Australia) in Settings, or paste
          jobs in manually from the Pipeline. Manual countries still work for tracking, tailoring,
          and outreach.
        </div>
      ) : null}
      {notice ? <p className="text-[11.5px] text-jade">{notice}</p> : null}

      {reveal ? (
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span>
            Showing all matches, including roles with no confirmed visa sponsorship.
          </span>
          <Link href="/discover" className="font-semibold text-jade">
            Back to sponsored only
          </Link>
        </div>
      ) : gatedCount > 0 ? (
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span>
            {gatedCount} more {gatedCount === 1 ? "role is" : "roles are"} hidden because sponsorship
            is not confirmed.
          </span>
          <Link href="/discover?all=1" className="font-semibold text-jade">
            Show unverified too
          </Link>
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-cardpad py-10">
          <p className="max-w-[54ch] text-center text-[12.5px] text-muted">
            New matches for your target countries appear here, scored and freshest first. Run a
            search now, or wait for the overnight run and morning digest.
          </p>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface">
          <div className="flex items-center gap-3 border-b border-line px-cardpad py-2 text-[11px]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="accent-[var(--jade)]"
              aria-label="select all"
              title="Select all"
            />
            {selected.size > 0 ? (
              <>
                <span className="text-muted">{selected.size} selected</span>
                <button type="button" onClick={bulkDismiss} className="font-semibold text-red">
                  Dismiss selected
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="text-faint hover:text-fg">
                  Clear
                </button>
              </>
            ) : (
              <span className="text-faint">Select jobs to dismiss in bulk</span>
            )}
            {pageCount > 1 ? <Pager page={page} pageCount={pageCount} onGo={goToPage} /> : null}
          </div>
          {jobs.map((j, i) => (
            <div key={j.id} className={cn("px-cardpad py-rowpad", i > 0 && "border-t border-line")}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(j.id)}
                  onChange={() => toggleSelect(j.id)}
                  className="accent-[var(--jade)]"
                  aria-label="select job"
                />
                {j.matchScore !== null ? <ScoreRing score={j.matchScore} size={36} /> : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold">{j.title}</span>
                    <SponsorPill status={j.sponsorship} />
                    {j.remote ? (
                      <span className="rounded-pill px-[8px] py-[2.5px] text-[10px] font-semibold text-violet" style={{ background: "color-mix(in srgb, var(--violet) 12%, transparent)" }}>
                        {j.remote}
                      </span>
                    ) : null}
                    {j.signals.map((s, k) => (
                      <span
                        key={k}
                        className={cn(
                          "rounded-pill px-[8px] py-[2.5px] text-[10px] font-semibold",
                          s.severity === "warn" ? "text-red" : "text-faint",
                        )}
                        style={{ background: s.severity === "warn" ? "color-mix(in srgb, var(--red) 12%, transparent)" : "var(--track)" }}
                        title="Signal, not a verdict"
                      >
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-muted">
                    {[j.companyName, j.location ?? j.countryCode, j.salary]
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    · via {j.source.replace("watch:", "watched ")}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10.5px] text-faint">{freshness(j.postedAt)}</span>
                <Button variant="secondary" onClick={() => setExpanded(expanded === j.id ? null : j.id)}>
                  Why
                </Button>
                <Button onClick={() => act(j.id, "save")} disabled={pending.has(j.id)}>
                  Save
                </Button>
                <Button variant="ghost" onClick={() => act(j.id, "dismiss")} disabled={pending.has(j.id)}>
                  Dismiss
                </Button>
              </div>
              {expanded === j.id ? (
                <div className="mt-2 rounded-[8px] bg-bg px-3 py-2">
                  <div className="mb-1 text-[11px] font-medium text-muted">Why this scored {j.matchScore}</div>
                  <ul className="list-disc pl-4 text-[11.5px] text-muted">
                    {j.matchExplanation.map((r, k) => (
                      <li key={k}>{r}</li>
                    ))}
                  </ul>
                  {j.url ? (
                    <a href={j.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block text-[11.5px] font-semibold text-jade">
                      Open the original posting
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {pageCount > 1 ? (
            <div className="flex items-center border-t border-line px-cardpad py-2.5">
              <Pager page={page} pageCount={pageCount} onGo={goToPage} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
