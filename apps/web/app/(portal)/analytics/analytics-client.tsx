"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, PICKABLE_CURRENCIES } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * The analytics dashboards: funnel, channel effectiveness, response-time
 * patterns, salary bands, and closed-loop insights. Everything reflects
 * the user's own seeded activity. Insights carry honest sample-size
 * labels and never assert more than the data supports.
 */

type Insight = {
  statement: string;
  n: number;
  confidence: "insufficient" | "low" | "moderate";
  actionable: boolean;
  detail: string;
};

type Band = {
  role: string;
  market: string;
  n: number;
  currency: string;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  confidence: "anecdotal" | "indicative" | "solid";
};

function Card({
  title,
  children,
  hint,
  action,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-baseline justify-between gap-2 p-cardpad pb-2.5">
        <h2 className="font-disp text-[13.5px] font-bold">{title}</h2>
        {action ?? (hint ? <span className="font-mono text-[10px] text-faint">{hint}</span> : null)}
      </div>
      <div className="border-t border-line p-cardpad">{children}</div>
    </div>
  );
}

/**
 * Salary bands read in each market's own currency by default. The picker
 * forces one currency across every market, for comparing like with like.
 */
function SalaryBands({ initial }: { initial: Band[] }) {
  const [bands, setBands] = React.useState(initial);
  const [currency, setCurrency] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => setBands(initial), [initial]);

  async function pick(next: string) {
    setCurrency(next);
    setLoading(true);
    const qs = next ? `?currency=${next}` : "";
    const res = await fetch(`/api/intel/salary${qs}`).catch(() => null);
    const payload = (await res?.json().catch(() => null)) as { ok?: boolean; bands?: Band[] } | null;
    if (payload?.ok && payload.bands) setBands(payload.bands);
    setLoading(false);
  }

  return (
    <Card
      title="Salary bands"
      action={
        <select
          value={currency}
          onChange={(e) => pick(e.target.value)}
          disabled={loading}
          aria-label="Report salary bands in"
          className="h-[26px] rounded-input border border-line bg-bg px-1.5 font-mono text-[10px] text-muted"
        >
          <option value="">Market currency</option>
          {PICKABLE_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      }
    >
      {bands.length === 0 ? (
        <p className="text-[12px] text-muted">No salaries parsed from your jobs yet.</p>
      ) : (
        <div className={cn("flex flex-col gap-2.5", loading && "opacity-50")}>
          {bands.map((b) => (
            <div key={`${b.role}-${b.market}`}>
              <div className="flex items-baseline justify-between">
                <span className="truncate text-[12px] font-semibold capitalize">{b.role}</span>
                <span className="font-mono text-[10px] uppercase" style={{ color: CONF_COLOR[b.confidence] }}>
                  {b.market} · {b.currency} · n={b.n} · {b.confidence}
                </span>
              </div>
              <div className="font-mono text-[11px] text-muted">
                {formatMoney(b.p25, b.currency)} <span className="text-faint">–</span>{" "}
                <span className="text-jade">{formatMoney(b.median, b.currency)}</span>{" "}
                <span className="text-faint">–</span> {formatMoney(b.p75, b.currency)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}


const CONF_COLOR: Record<string, string> = {
  insufficient: "var(--faint)",
  low: "var(--amber)",
  moderate: "var(--jade)",
  anecdotal: "var(--faint)",
  indicative: "var(--amber)",
  solid: "var(--jade)",
};

export function AnalyticsClient({
  funnel,
  totalSaved,
  channels,
  response,
  insights,
  totalSamples,
  bands,
}: {
  funnel: { key: string; label: string; count: number; color: string }[];
  totalSaved: number;
  channels: { source: string; total: number; applied: number; interview: number; offer: number; rejected: number }[];
  response: { gaps: number[]; median: number | null; n: number };
  insights: Insight[];
  totalSamples: number;
  bands: Band[];
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <div>
        <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">Analytics</h1>
        <p className="text-[11.5px] text-muted">
          Your funnel, where jobs come from, how fast people reply, and what has correlated with getting
          interviews. Read the confidence labels: with little data these are hints, not conclusions.
        </p>
      </div>

      <div className="mt-gap columns-1 [column-gap:var(--gap)] @4xl:columns-2 [&>*]:mb-gap [&>*]:break-inside-avoid">
      <Card title="Funnel" hint={`${totalSaved} in pipeline`}>
        {totalSaved === 0 ? (
          <p className="text-[12px] text-muted">Save some jobs to the pipeline and the funnel fills in here.</p>
        ) : (
          <div style={{ width: "100%", height: 220 }}>
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel} margin={{ top: 4, right: 8, bottom: 4, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--faint)", fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={48} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--faint)", fontSize: 10 }} />
                  <Tooltip
                    cursor={{ fill: "var(--jade-dim)" }}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: "var(--text)" }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {funnel.map((s) => (
                      <Cell key={s.key} fill={s.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        )}
      </Card>

      <Card title="Channel effectiveness" hint="applied to interview rate">
        {channels.length === 0 ? (
          <p className="text-[12px] text-muted">No saved jobs with a source yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                  <th className="pb-2 pr-4">Source</th>
                  <th className="pb-2 pr-4">Jobs</th>
                  <th className="pb-2 pr-4">Applied</th>
                  <th className="pb-2 pr-4">Interview</th>
                  <th className="pb-2 pr-4">Offer</th>
                  <th className="pb-2">Interview rate</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => {
                  const rate = c.applied > 0 ? Math.round((c.interview / c.applied) * 100) : 0;
                  return (
                    <tr key={c.source} className="border-t border-line">
                      <td className="py-2 pr-4 font-semibold">{c.source}</td>
                      <td className="py-2 pr-4 font-mono text-[11px]">{c.total}</td>
                      <td className="py-2 pr-4 font-mono text-[11px]">{c.applied}</td>
                      <td className="py-2 pr-4 font-mono text-[11px]">{c.interview}</td>
                      <td className="py-2 pr-4 font-mono text-[11px]">{c.offer}</td>
                      <td className="py-2 font-mono text-[11px]" style={{ color: rate >= 30 ? "var(--jade)" : "var(--muted)" }}>
                        {c.applied > 0 ? `${rate}%` : "n/a"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-gap md:grid-cols-2">
        <Card title="Response time" hint="outreach to reply">
          {response.n === 0 ? (
            <p className="text-[12px] text-muted">No outreach replies recorded yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-disp text-[22px] font-extrabold tracking-[-0.02em] text-jade">
                  {response.median !== null ? response.median.toFixed(1) : "n/a"}
                </span>
                <span className="text-[11.5px] text-muted">median days to a reply</span>
              </div>
              <p className="font-mono text-[10.5px] text-faint">
                from {response.n} replied thread{response.n === 1 ? "" : "s"}
                {response.n < 5 ? ", too few to read much into" : ""}
              </p>
              <div className="flex flex-wrap gap-1">
                {response.gaps.slice(0, 20).map((g, i) => (
                  <span key={i} className="rounded-pill bg-track px-[7px] py-[2px] font-mono text-[10px] text-faint">
                    {g.toFixed(1)}d
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <SalaryBands initial={bands} />
      </div>

      <Card title="What is working" hint={`${totalSamples} outcome${totalSamples === 1 ? "" : "s"} on file`}>
        {insights.length === 0 ? (
          <p className="text-[12px] text-muted">
            Not enough completed applications yet to find patterns. As you apply, do outreach, and record
            outcomes, honest low-confidence insights appear here, then firm up as the numbers grow.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span
                  className="mt-[3px] h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: CONF_COLOR[ins.confidence] }}
                />
                <div className="min-w-0">
                  <p className="text-[12px]">{ins.statement}</p>
                  <p className="font-mono text-[10px] text-faint">
                    {ins.confidence} confidence · n={ins.n} · {ins.detail}
                  </p>
                </div>
              </div>
            ))}
            <p className="mt-1 border-t border-line pt-2 font-mono text-[10px] text-faint">
              These are correlations from your own history, not proven cause. Tess treats them as gentle hints.
            </p>
          </div>
        )}
      </Card>
      </div>
    </div>
  );
}
