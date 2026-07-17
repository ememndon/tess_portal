import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";

/**
 * Salary parsing and currency normalization. Turns a free-text salary
 * string into min/max, currency, and period, then offers an
 * annual-EUR-equivalent for comparison across markets.
 */

export type ParsedSalary = {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "year" | "month" | "day" | "hour" | null;
};

const CURRENCY_TOKENS: { re: RegExp; code: string }[] = [
  { re: /NZ\$|NZD/i, code: "NZD" },
  { re: /AU\$|AUD/i, code: "AUD" },
  { re: /CA\$|C\$|CAD/i, code: "CAD" },
  { re: /US\$|USD/i, code: "USD" },
  { re: /€|EUR/i, code: "EUR" },
  { re: /£|GBP/i, code: "GBP" },
  { re: /AED|د\.إ/i, code: "AED" },
  { re: /QAR|ر\.ق/i, code: "QAR" },
  { re: /SAR|ر\.س/i, code: "SAR" },
  { re: /NOK|\bkr\b/i, code: "NOK" },
  { re: /\$/, code: "USD" }, // bare dollar, last resort
];

const PERIODS: { re: RegExp; period: ParsedSalary["period"] }[] = [
  { re: /per\s*hour|\/\s*h(ou)?r|hourly/i, period: "hour" },
  { re: /per\s*day|\/\s*day|daily|day\s*rate/i, period: "day" },
  { re: /per\s*month|\/\s*mo(nth)?|monthly|p\/m|pcm/i, period: "month" },
  { re: /per\s*year|\/\s*(yr|year|annum)|per\s*annum|annual|p\.?a\.?|\/yr/i, period: "year" },
];

function toNumber(raw: string): number | null {
  let s = raw.replace(/[,\s]/g, "");
  const kMatch = /^(\d+(?:\.\d+)?)k$/i.exec(s);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  s = s.replace(/k$/i, "000");
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseSalary(raw: string | null | undefined): ParsedSalary {
  const empty: ParsedSalary = { min: null, max: null, currency: null, period: null };
  if (!raw) return empty;
  const text = raw.trim();

  let currency: string | null = null;
  for (const c of CURRENCY_TOKENS) {
    if (c.re.test(text)) {
      currency = c.code;
      break;
    }
  }

  let period: ParsedSalary["period"] = null;
  for (const p of PERIODS) {
    if (p.re.test(text)) {
      period = p.period;
      break;
    }
  }

  let min: number | null = null;
  let max: number | null = null;

  // a range like "45-60k" or "€45k - €60k": a trailing k applies to both
  // ends, so the lower bound is never dropped
  const range = /(\d[\d,.]*)\s*(k)?\s*(?:-|–|—|to)\s*[€£$]?\s*(\d[\d,.]*)\s*(k)?/i.exec(text);
  if (range) {
    const rangeHasK = Boolean(range[2] || range[4]);
    let a = toNumber(range[1] + (range[2] ?? ""));
    let b = toNumber(range[3] + (range[4] ?? ""));
    if (a !== null && b !== null) {
      if (rangeHasK && a < 1000) a *= 1000;
      if (rangeHasK && b < 1000) b *= 1000;
      min = Math.min(a, b);
      max = Math.max(a, b);
    }
  }

  if (min === null) {
    // single value or several numbers: prefer salary-scale figures so a
    // stray "team of 200" or "5 years" is not mistaken for pay, and take
    // the full span rather than only the first two
    const nums = [...text.matchAll(/(\d[\d,.]*\s*k?)/gi)]
      .map((m) => toNumber(m[1]))
      .filter((n): n is number => n !== null);
    const salaryScale = nums.filter((n) => n >= 1000);
    const pool = salaryScale.length > 0 ? salaryScale : nums.filter((n) => n >= 100);
    if (pool.length >= 2) {
      min = Math.min(...pool);
      max = Math.max(...pool);
    } else if (pool.length === 1) {
      min = pool[0];
      max = pool[0];
    }
  }

  // infer period from magnitude when unstated
  if (!period && max !== null) {
    if (max <= 400) period = "day";
    else if (max <= 30000) period = "month";
    else period = "year";
  }

  return { min, max, currency, period };
}

const ANNUAL_MULTIPLIER: Record<NonNullable<ParsedSalary["period"]>, number> = {
  year: 1,
  month: 12,
  day: 230,
  hour: 1800,
};

// currencies the ECB reference set (frankfurter) does not cover: pegged
const FIXED_TO_USD: Record<string, number> = { AED: 3.6725, QAR: 3.64, SAR: 3.75 };

type RateMap = Map<string, number>; // EUR -> currency

export async function loadRates(db: Db): Promise<RateMap> {
  const rows = await db
    .select()
    .from(schema.currencyRates)
    .where(eq(schema.currencyRates.base, "EUR"));
  const map: RateMap = new Map();
  for (const r of rows) map.set(r.target, Number(r.rate));
  map.set("EUR", 1);
  return map;
}

/** Converts an amount in `currency` to EUR using cached rates. */
export function toEur(amount: number, currency: string, rates: RateMap): number | null {
  if (currency === "EUR") return amount;
  const direct = rates.get(currency);
  if (direct) return amount / direct;
  // gulf pegs: currency -> USD -> EUR
  const peg = FIXED_TO_USD[currency];
  const eurUsd = rates.get("USD");
  if (peg && eurUsd) return amount / peg / eurUsd;
  return null;
}

/** Annual EUR-equivalent midpoint for comparison and sorting. */
export function annualEur(
  salary: {
    salaryMin: string | number | null;
    salaryMax: string | number | null;
    salaryCurrency: string | null;
    salaryPeriod: string | null;
  },
  rates: RateMap,
): number | null {
  const min = salary.salaryMin === null ? null : Number(salary.salaryMin);
  const max = salary.salaryMax === null ? null : Number(salary.salaryMax);
  const mid = min !== null && max !== null ? (min + max) / 2 : (min ?? max);
  if (mid === null || !salary.salaryCurrency || !salary.salaryPeriod) return null;
  const period = salary.salaryPeriod as NonNullable<ParsedSalary["period"]>;
  const annual = mid * (ANNUAL_MULTIPLIER[period] ?? 1);
  return toEur(annual, salary.salaryCurrency, rates);
}
