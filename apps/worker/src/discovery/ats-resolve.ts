import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { politeFetch } from "./fetch";
import { ATS_ADAPTERS } from "./adapters/ats";
import { normalize } from "./dedup";
import type { FetchContext } from "./types";

/**
 * Sponsor-company → ATS board resolver. The sponsor registers give us the
 * NAMES of every company licensed to sponsor a work visa; this turns a batch
 * of those names into direct career-page sources by probing the public ATS
 * APIs for a board whose own canonical NAME matches the company. A hit becomes
 * a `sources` row the discovery run then deep-reads; a miss is remembered in
 * ats_resolution so it is not re-probed. Bounded per run and cached, so it
 * walks each register a batch at a time.
 *
 * Only Greenhouse and Workable are probed here: both expose the board's real
 * company name, so every hit is VERIFIED against the sponsor (a bare slug like
 * "aa" or "bw" otherwise collides with unrelated boards). Lever/Ashby/Recruitee
 * carry no name in their public feed, so they are left to the website-based
 * watchlist resolver, which already knows the company's real domain.
 *
 * NZ has no bulk register, so it is not probed (its sponsors still surface via
 * the firehose + text inference).
 */

const RESOLVE_COUNTRIES = new Set(["GB", "IE", "NL"]);
const DEFAULT_LIMIT = 300; // companies probed per country per daily run (bounded walk of the register)

const PROBES: {
  adapter: "greenhouse" | "workable";
  config: (slug: string) => Record<string, unknown>;
  nameUrl: (slug: string) => string;
}[] = [
  {
    adapter: "greenhouse",
    config: (s) => ({ adapter: "greenhouse", board: s }),
    nameUrl: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}`,
  },
  {
    adapter: "workable",
    config: (s) => ({ adapter: "workable", account: s }),
    nameUrl: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`,
  },
];

/** Candidate board slugs derived from a company name, most-specific first. */
export function slugCandidates(companyName: string): string[] {
  const norm = normalize(companyName); // lowercased, punctuation → spaces
  const words = norm.split(" ").filter(Boolean);
  const collapsed = words.join(""); // "ing bank" → "ingbank"
  const first = words[0] ?? ""; // "ing"
  const cands = [collapsed];
  // a multi-word company's brand is usually its first word (Monzo Bank → monzo),
  // but only trust a first-word slug when it's distinctive enough (>=5 chars) —
  // a short common word (able/casa/bw/aa) lead-matches unrelated boards
  if (first.length >= 5 && first !== collapsed) cands.push(first);
  return [...new Set(cands)].filter((s) => s.length >= 3);
}

/**
 * Verifies a candidate board really belongs to the sponsor: the board's own
 * collapsed name must be a leading chunk of the sponsor's collapsed name (or
 * vice versa), at least 4 chars. This accepts "Monzo" → "Monzo Bank Limited"
 * but rejects a stray "bw"/"aa"/"casa" board that merely shares a slug.
 */
export function namesMatch(boardName: string, sponsorName: string): boolean {
  const bc = normalize(boardName).replace(/\s+/g, "");
  const sc = normalize(sponsorName).replace(/\s+/g, "");
  if (bc.length < 4) return false;
  return sc.startsWith(bc) || bc.startsWith(sc);
}

async function boardName(nameUrl: string): Promise<string | null> {
  try {
    const res = await politeFetch(nameUrl, { proxyUrl: null });
    if (!res.ok) return null;
    const d = (await res.json()) as { name?: string };
    return typeof d.name === "string" ? d.name : null;
  } catch {
    return null;
  }
}

/** Finds a verified Greenhouse/Workable board for a company, or null. */
async function probeVerified(
  companyName: string,
  ctx: FetchContext,
): Promise<{ adapter: string; config: Record<string, unknown> } | null> {
  for (const slug of slugCandidates(companyName)) {
    for (const p of PROBES) {
      try {
        const postings = await ATS_ADAPTERS[p.adapter](p.config(slug), ctx);
        if (postings.length === 0) continue;
        const name = await boardName(p.nameUrl(slug));
        if (name && namesMatch(name, companyName)) {
          return { adapter: p.adapter, config: { ...p.config(slug), companyName } };
        }
      } catch {
        // not this platform / slug — try the next
      }
    }
  }
  return null;
}

export async function resolveSponsorBoards(
  db: Db,
  log: Logger,
  opts: { countries?: string[]; limit?: number } = {},
): Promise<string> {
  const countries = (opts.countries ?? [...RESOLVE_COUNTRIES]).filter((c) => RESOLVE_COUNTRIES.has(c));
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const ctx: FetchContext = { proxyUrl: null, log: () => {} };
  let probed = 0;
  let resolved = 0;

  for (const country of countries) {
    const rows = await db
      .select({
        companyName: schema.sponsorRegistry.companyName,
        normalizedName: schema.sponsorRegistry.normalizedName,
      })
      .from(schema.sponsorRegistry)
      .leftJoin(
        schema.atsResolution,
        and(
          eq(schema.atsResolution.countryCode, schema.sponsorRegistry.countryCode),
          eq(schema.atsResolution.normalizedName, schema.sponsorRegistry.normalizedName),
        ),
      )
      .where(and(eq(schema.sponsorRegistry.countryCode, country), isNull(schema.atsResolution.id)))
      .limit(limit);

    for (const row of rows) {
      probed += 1;
      const hit = await probeVerified(row.companyName, ctx);

      if (hit) {
        const name = `${row.companyName} · ${hit.adapter}`;
        const existing = await db
          .select({ id: schema.sources.id })
          .from(schema.sources)
          .where(eq(schema.sources.name, name))
          .limit(1);
        let sourceId = existing[0]?.id ?? null;
        if (!sourceId) {
          const [ins] = await db
            .insert(schema.sources)
            .values({ countryCode: country, name, type: "ats", config: hit.config, proxyEnabled: false, enabled: true })
            .returning({ id: schema.sources.id });
          sourceId = ins.id;
        }
        await db
          .insert(schema.atsResolution)
          .values({ countryCode: country, normalizedName: row.normalizedName, status: "resolved", adapter: hit.adapter, config: hit.config, sourceId })
          .onConflictDoNothing();
        resolved += 1;
        log.info({ country, company: row.companyName, adapter: hit.adapter }, "sponsor ATS board resolved");
      } else {
        await db
          .insert(schema.atsResolution)
          .values({ countryCode: country, normalizedName: row.normalizedName, status: "miss" })
          .onConflictDoNothing();
      }
    }
  }

  return `ats board resolution: probed ${probed}, resolved ${resolved} verified sponsor career pages`;
}
