import { eq } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { getDb } from "./db";

// presentation helpers live in lib/currency.ts so client components can use them too
export { formatSalaryNative, formatMoney } from "@/lib/currency";

/** EUR-based rate map from the cached currency_rates table. */
export async function loadRates(): Promise<Map<string, number>> {
  const rows = await getDb()
    .select()
    .from(schema.currencyRates)
    .where(eq(schema.currencyRates.base, "EUR"));
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.target, Number(r.rate));
  map.set("EUR", 1);
  return map;
}

const ANNUAL: Record<string, number> = { year: 1, month: 12, day: 230, hour: 1800 };
const FIXED_TO_USD: Record<string, number> = { AED: 3.6725, QAR: 3.64, SAR: 3.75 };

function toEur(amount: number, currency: string, rates: Map<string, number>): number | null {
  if (currency === "EUR") return amount;
  const direct = rates.get(currency);
  if (direct) return amount / direct;
  const peg = FIXED_TO_USD[currency];
  const usd = rates.get("USD");
  if (peg && usd) return amount / peg / usd;
  return null;
}

/** The inverse of toEur: an EUR amount expressed in `currency`. Null when unconvertible. */
export function fromEur(amount: number, currency: string, rates: Map<string, number>): number | null {
  if (currency === "EUR") return amount;
  const direct = rates.get(currency);
  if (direct) return amount * direct;
  const peg = FIXED_TO_USD[currency];
  const usd = rates.get("USD");
  if (peg && usd) return amount * usd * peg;
  return null;
}

type SalaryFields = {
  salaryMin: string | null;
  salaryMax: string | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
};

/** Normalized annual EUR-equivalent for a job, used only as a common unit for aggregation. */
export function normalizedAnnualEur(job: SalaryFields, rates: Map<string, number>): number | null {
  const min = job.salaryMin === null ? null : Number(job.salaryMin);
  const max = job.salaryMax === null ? null : Number(job.salaryMax);
  const mid = min !== null && max !== null ? (min + max) / 2 : (min ?? max);
  if (mid === null || !job.salaryCurrency || !job.salaryPeriod) return null;
  const annual = mid * (ANNUAL[job.salaryPeriod] ?? 1);
  return toEur(annual, job.salaryCurrency, rates);
}
