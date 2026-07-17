/**
 * Pure currency presentation, safe to import from client components. The
 * server-only rate lookups and conversion live in lib/server/money.ts.
 */

export const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€", GBP: "£", USD: "$", AUD: "A$", NZD: "NZ$", CAD: "C$", CHF: "CHF ",
  SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł", INR: "₹", ZAR: "R",
  AED: "AED ", QAR: "QAR ", SAR: "SAR ",
};

/** Currencies offered in the salary-band picker, in the order shown. */
export const PICKABLE_CURRENCIES = ["EUR", "GBP", "USD", "NZD", "AUD", "CAD", "AED", "QAR", "SAR"] as const;

const PERIOD_SUFFIX: Record<string, string> = { year: "/yr", month: "/mo", day: "/day", hour: "/hr" };

const symbolFor = (currency: string) => CURRENCY_SYMBOLS[currency] ?? `${currency} `;

/** A single amount with its currency, e.g. "£95,000". */
export function formatMoney(amount: number, currency: string): string {
  return `${symbolFor(currency)}${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * "k" only once the figure is big enough that the rounding is lossless to the
 * reader: a 3,500/month salary must not read as "4k". The unit is chosen from
 * the largest figure so a range never mixes "9,000–12k".
 */
function amounts(values: number[]): string[] {
  const useK = Math.max(...values) >= 10000;
  return values.map((n) => (useK ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString("en-US")));
}

type SalaryFields = {
  salaryMin: string | null;
  salaryMax: string | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
};

/**
 * The salary exactly as the employer quoted it — a UK job reads "£65k–85k/yr",
 * a Dutch one "€3,500–5,000/mo". Never converted to another currency.
 */
export function formatSalaryNative(job: SalaryFields): string | null {
  const min = job.salaryMin === null ? null : Number(job.salaryMin);
  const max = job.salaryMax === null ? null : Number(job.salaryMax);
  if (!job.salaryCurrency || (min === null && max === null)) return null;
  const sym = symbolFor(job.salaryCurrency);
  const suffix = PERIOD_SUFFIX[job.salaryPeriod ?? ""] ?? "";
  if (min !== null && max !== null && min !== max) {
    const [lo, hi] = amounts([min, max]);
    return `${sym}${lo}–${hi}${suffix}`;
  }
  return `${sym}${amounts([(min ?? max) as number])[0]}${suffix}`;
}
