import { runCompletion } from "@/lib/ai/run";
import { formatMoney } from "@/lib/currency";
import { scopeFor } from "@/lib/server/dal";
import { fromEur, loadRates, normalizedAnnualEur } from "@/lib/server/money";

/**
 * Salary intelligence aggregated from the user's own jobs database, per role
 * and market. A median needs one unit, so postings are pooled in annual EUR
 * internally, then the band is reported in the market's own currency — a UK
 * band reads in GBP, an Irish one in EUR. Where a market carries postings in
 * more than one currency, the dominant one wins and the minority are converted
 * into it, keeping the sample intact. The caller may force a currency instead.
 *
 * Every figure carries its sample size so nothing is over-read: a median from
 * three postings is labeled as such. The negotiation script generator anchors
 * on these numbers and never invents a market rate.
 */

export type SalaryBand = {
  role: string;
  market: string;
  n: number;
  /** the currency every figure below is expressed in */
  currency: string;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  confidence: "anecdotal" | "indicative" | "solid";
};

const SENIORITY = /\b(senior|sr|junior|jr|lead|staff|principal|mid|entry|graduate|intern|i{1,3}|iv|v|1|2|3)\b/gi;

/** Collapses a job title to a coarse role bucket for aggregation. */
export function roleKey(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(SENIORITY, " ")
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "role";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function confidenceFor(n: number): SalaryBand["confidence"] {
  if (n >= 12) return "solid";
  if (n >= 5) return "indicative";
  return "anecdotal";
}

/**
 * The currency a market's band is reported in: whichever the most postings are
 * quoted in. Ties break alphabetically so the choice is stable run to run.
 */
export function dominantCurrency(counts: Map<string, number>): string {
  let best = "EUR";
  let bestN = -1;
  for (const [currency, n] of [...counts].sort((a, z) => a[0].localeCompare(z[0]))) {
    if (n > bestN) {
      best = currency;
      bestN = n;
    }
  }
  return best;
}

export async function salaryBands(
  userId: string,
  opts: { currency?: string } = {},
): Promise<SalaryBand[]> {
  const [observations, rates] = await Promise.all([
    scopeFor(userId).salaryObservations(),
    loadRates(),
  ]);

  type Bucket = { role: string; market: string; values: number[]; currencies: Map<string, number> };
  const buckets = new Map<string, Bucket>();
  for (const o of observations) {
    const eur = normalizedAnnualEur(o, rates);
    if (eur === null || eur <= 0) continue;
    const role = roleKey(o.title);
    const market = o.countryCode ?? o.market ?? "unknown";
    const key = `${role}::${market}`;
    const bucket: Bucket = buckets.get(key) ?? { role, market, values: [], currencies: new Map() };
    bucket.values.push(Math.round(eur));
    if (o.salaryCurrency) {
      bucket.currencies.set(o.salaryCurrency, (bucket.currencies.get(o.salaryCurrency) ?? 0) + 1);
    }
    buckets.set(key, bucket);
  }

  const bands: SalaryBand[] = [];
  for (const b of buckets.values()) {
    const sorted = [...b.values].sort((a, z) => a - z);
    const want = opts.currency ?? dominantCurrency(b.currencies);
    // percentiles are order-preserving under a linear rate, so converting the
    // five statistics gives the same answer as converting every observation
    const conv = (n: number) => fromEur(n, want, rates);
    const stats = [sorted[0], percentile(sorted, 25), percentile(sorted, 50), percentile(sorted, 75), sorted[sorted.length - 1]];
    const converted = stats.map(conv);
    // an unconvertible currency (no cached rate) falls back to EUR rather than lying
    const usable = converted.every((v): v is number => v !== null);
    const [min, p25, median, p75, max] = usable ? (converted as number[]) : stats;
    bands.push({
      role: b.role,
      market: b.market,
      n: sorted.length,
      currency: usable ? want : "EUR",
      min: Math.round(min),
      p25: Math.round(p25),
      median: Math.round(median),
      p75: Math.round(p75),
      max: Math.round(max),
      confidence: confidenceFor(sorted.length),
    });
  }

  return bands.sort((a, z) => z.n - a.n);
}

/**
 * A deterministic, data-grounded negotiation script. Always available.
 * `currentOffer` is read in the same currency the band is reported in.
 */
function templateScript(
  band: SalaryBand | null,
  role: string,
  market: string,
  currency: string,
  currentOffer?: number,
): string {
  const money = (n: number) => formatMoney(n, currency);
  const lines: string[] = [];
  if (!band) {
    lines.push(
      `I do not have enough salary data on file for ${role} in ${market} to anchor a number. Add a few more postings for this role, or set a target in your learned profile, and I will build the script on real figures.`,
    );
    if (currentOffer) {
      lines.push(
        `\nWith the offer you mentioned (${money(currentOffer)}), a safe opening is to thank them, restate your enthusiasm, and ask for the top of their band while you gather comparable roles.`,
      );
    }
    return lines.join("\n");
  }

  const dataLabel =
    band.confidence === "anecdotal"
      ? `only ${band.n} comparable posting${band.n === 1 ? "" : "s"}, treat this as anecdotal`
      : band.confidence === "indicative"
        ? `${band.n} comparable postings, indicative not definitive`
        : `${band.n} comparable postings, a solid sample`;

  lines.push(
    `Market anchor for ${role} in ${market}: median ${money(band.median)}, typical range ${money(band.p25)} to ${money(band.p75)} (${dataLabel}).`,
  );
  lines.push("");
  lines.push("Opening line:");
  lines.push(
    `"Thank you, I'm genuinely excited about this. Based on what I'm seeing for ${role} roles in this market, I was expecting something closer to ${money(band.p75)}. Is there room to get there?"`,
  );
  lines.push("");
  if (currentOffer) {
    const gap = band.median - currentOffer;
    if (gap > 0) {
      lines.push(
        `Their offer of ${money(currentOffer)} sits below the ${money(band.median)} median, so asking to close the gap is well grounded.`,
      );
    } else {
      lines.push(
        `Their offer of ${money(currentOffer)} is at or above the ${money(band.median)} median, so lead with total package (bonus, equity, learning budget) rather than base.`,
      );
    }
    lines.push("");
  }
  lines.push("If they hold: pivot to non-base levers, and ask for a written review at 6 months tied to specific goals.");
  lines.push("Always keep it collaborative. You are solving a problem together, not making a demand.");
  return lines.join("\n");
}

const NEGOTIATION_SYSTEM = `You are a salary negotiation coach. You are given real salary data (a range and sample size) drawn from the user's own job database, and an optional current offer. Write a short, practical negotiation script.

Hard rules:
- Anchor every number on the data given. Do not invent a market rate. If the sample size is small, say so plainly.
- Quote every figure in the currency stated in the data. Never convert it to another currency.
- Keep the tone collaborative and specific. No filler.
- 150 words or fewer.`;

export async function negotiationScript(
  userId: string,
  /** `currency` forces the reporting currency; otherwise the market's own is used. `currentOffer` is read in that currency. */
  input: { role: string; market?: string; currentOffer?: number; currency?: string },
): Promise<{ script: string; band: SalaryBand | null; source: "model" | "template"; currency: string }> {
  const bands = await salaryBands(userId, { currency: input.currency });
  const market = input.market ?? "unknown";
  const wantRole = roleKey(input.role);
  const band =
    bands.find((b) => b.role === wantRole && b.market === market) ??
    bands.find((b) => b.role === wantRole) ??
    null;
  const currency = band?.currency ?? input.currency ?? "EUR";
  const money = (n: number) => formatMoney(n, currency);

  const template = templateScript(band, input.role, market, currency, input.currentOffer);
  if (!band) return { script: template, band, source: "template", currency };

  const prompt = `Role: ${input.role}\nMarket: ${market}\nSalary data (annual ${currency}): median ${band.median}, p25 ${band.p25}, p75 ${band.p75}, from ${band.n} postings (${band.confidence}).${
    input.currentOffer ? `\nCurrent offer: ${currency} ${input.currentOffer}` : ""
  }`;
  const completion = await runCompletion({
    activity: "negotiation",
    userId,
    system: NEGOTIATION_SYSTEM,
    prompt,
    maxTokens: 500,
  }).catch(() => null);

  if (completion?.text?.trim()) {
    return {
      script: `${completion.text.trim()}\n\nData: median ${money(band.median)}, range ${money(band.p25)}-${money(band.p75)}, ${band.n} postings (${band.confidence}).`,
      band,
      source: "model",
      currency,
    };
  }
  return { script: template, band, source: "template", currency };
}
