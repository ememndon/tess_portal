import { asc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { SourceConfig } from "./types";

/**
 * Source configuration is data, not code. Each country maps to its sources;
 * each source declares its type (ATS feed, RSS, crawl) and a proxy toggle.
 *
 * There are NO hardcoded company boards any more: country-wide breadth comes
 * from the provider firehose (see adapters/providers.ts), which searches every
 * company advertising in a target country off the user's roles/résumé, and the
 * companies a user actually cares about are added by the watchlist monitor when
 * they save a job. Seeding a fixed company list made discovery "focus" on those
 * few employers (and leaked their global/US roles), which is exactly what the
 * firehose replaced — so the seed set is intentionally empty.
 */

type Seed = {
  countryCode: string;
  name: string;
  type: "ats" | "rss" | "crawl";
  config: Record<string, unknown>;
  proxyEnabled?: boolean;
};

const SEED_SOURCES: Seed[] = [];

export async function seedSources(db: Db): Promise<void> {
  if (SEED_SOURCES.length === 0) return;
  const existing = await db.select({ name: schema.sources.name }).from(schema.sources);
  const have = new Set(existing.map((e) => e.name));
  for (const s of SEED_SOURCES) {
    if (have.has(s.name)) continue;
    await db.insert(schema.sources).values({
      countryCode: s.countryCode,
      name: s.name,
      type: s.type,
      config: s.config,
      proxyEnabled: s.proxyEnabled ?? false,
      enabled: true,
    });
  }
}

export async function sourcesForCountries(db: Db, countryCodes: string[]): Promise<SourceConfig[]> {
  if (countryCodes.length === 0) return [];
  const rows = await db
    .select()
    .from(schema.sources)
    .where(inArray(schema.sources.countryCode, countryCodes))
    .orderBy(asc(schema.sources.countryCode));
  return rows
    .filter((r) => r.enabled)
    .map((r) => ({
      id: r.id,
      countryCode: r.countryCode,
      name: r.name,
      type: r.type as SourceConfig["type"],
      config: (r.config ?? {}) as Record<string, unknown>,
      proxyEnabled: r.proxyEnabled,
      enabled: r.enabled,
    }));
}

export async function recordDiscoveryRun(
  db: Db,
  run: { sourceId: string | null; sourceName: string; status: string; fetched: number; error?: string; durationMs: number },
): Promise<void> {
  await db.insert(schema.discoveryRuns).values({
    sourceId: run.sourceId,
    sourceName: run.sourceName,
    status: run.status,
    fetched: run.fetched,
    error: run.error ?? null,
    durationMs: run.durationMs,
  });
}
