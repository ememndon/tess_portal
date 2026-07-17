import { schema, type Db } from "@tessportal/db";

/**
 * Daily currency rates from frankfurter.app, base EUR, cached in the
 * database. Runs as a scheduled task. Frankfurter uses ECB reference
 * rates, so Gulf pegs are handled separately in normalize.ts.
 */
const TARGETS = ["USD", "GBP", "NOK", "CAD", "AUD", "NZD", "SEK", "DKK", "CHF", "PLN"];

export async function fetchCurrencyRates(db: Db): Promise<string> {
  const res = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=${TARGETS.join(",")}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`frankfurter answered ${res.status}`);
  const data = (await res.json()) as { rates: Record<string, number> };
  const now = new Date();
  let count = 0;
  for (const [target, rate] of Object.entries(data.rates)) {
    await db
      .insert(schema.currencyRates)
      .values({ base: "EUR", target, rate: String(rate), fetchedAt: now })
      .onConflictDoUpdate({
        target: [schema.currencyRates.base, schema.currencyRates.target],
        set: { rate: String(rate), fetchedAt: now },
      });
    count += 1;
  }
  return `updated ${count} EUR rates`;
}
