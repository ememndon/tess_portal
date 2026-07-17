import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { ATS_ADAPTERS } from "./adapters/ats";
import { rss } from "./adapters/rss";
import { crawl } from "./adapters/crawl";
import { buildEmbedder, cosine } from "./embed";
import { fingerprint, findDuplicate } from "./dedup";
import { titleRelevance } from "./relevance";
import { detectSignals } from "./signals";
import { scoreJob, type ScoreContext } from "./score";
import { loadSponsorIndex, matchSponsorIndexed } from "./sponsors";
import { parseSalary } from "./normalize";
import { mentionsSponsorship, deniesSponsorship, isGulf } from "./countries";
import { recordDiscoveryRun, sourcesForCountries } from "./sources";
import { PROVIDERS, PROVIDER_ADAPTERS, resolveProviderKeys } from "./adapters/providers";
import { resolveProxyUrl } from "./proxy";
import type { FetchContext, RawPosting, SourceConfig } from "./types";

/**
 * Per-user discovery. Pulls sources for the user's target countries,
 * dedups, scores against their profile context, detects signals, and
 * matches sponsors, then stores fresh candidates as unsaved jobs for
 * Discover. Research, drafting, and tailoring on the top matches are
 * later-phase extensions that hook onto the saved candidates.
 */

async function fetchSource(source: SourceConfig, ctx: FetchContext): Promise<RawPosting[]> {
  if (source.type === "ats") {
    const adapter = ATS_ADAPTERS[String(source.config.adapter)];
    if (!adapter) throw new Error(`no adapter ${source.config.adapter}`);
    return adapter(source.config, ctx);
  }
  if (source.type === "rss") return rss(source.config, ctx);
  return crawl(source.config, ctx);
}

/** Drop postings known to be older than a month (unknown dates are kept). */
const FRESH_CUTOFF_MS = 30 * 86400000;
function isFresh(raw: RawPosting): boolean {
  return !raw.postedAt || raw.postedAt.getTime() >= Date.now() - FRESH_CUTOFF_MS;
}

// Embedding cosine above which a non-strong lexical title match is rescued
// rather than dropped. Job vectors are title+description while the searched
// title vector is title-only, so the bar is moderate and biased toward recall
// (keep good synonym matches). Provider-aware because the two embedding models
// sit on different cosine scales.
const RESCUE_OPENAI = 0.48;
const RESCUE_LOCAL = 0.55;

function matchesQuery(raw: RawPosting, query: string | undefined): boolean {
  if (!query) return true;
  const re = new RegExp(query, "i");
  return re.test(`${raw.title} ${raw.description}`);
}

/**
 * The searched title a job title best matches. Company/ATS board postings
 * aren't tied to a single query, so this picks the closest of the user's
 * searched titles to run them through the same role-relevance gate as the
 * firehose (a watched sponsor should still only surface on-role roles).
 */
function bestSearchTitle(jobTitle: string, searchTitles: string[]): string | undefined {
  if (searchTitles.length === 0) return undefined;
  let best = searchTitles[0];
  let bestScore = -1;
  for (const t of searchTitles) {
    const r = titleRelevance(jobTitle, t);
    const s = (r.headPresent ? 1 : 0) + r.coverage;
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best;
}

type MasterProfile = {
  headline: string;
  skills: string[];
  experienceTitles: string[];
  embedding: number[] | null;
};

/** The résumé's structured master profile (headline/titles/skills + embedding). */
async function loadMasterProfile(db: Db, userId: string): Promise<MasterProfile> {
  const [p] = await db
    .select({ data: schema.profiles.data, embedding: schema.profiles.embedding })
    .from(schema.profiles)
    .where(and(eq(schema.profiles.userId, userId), eq(schema.profiles.kind, "master")))
    .limit(1);
  const data =
    (p?.data as { headline?: string; skills?: unknown[]; experience?: unknown[] } | undefined) ?? {};
  const skills = Array.isArray(data.skills)
    ? data.skills.map((s) => (typeof s === "string" ? s : (s as { name?: string })?.name ?? "")).filter(Boolean)
    : [];
  const experienceTitles = Array.isArray(data.experience)
    ? data.experience
        .map((e) => {
          const item = e as { title?: string; role?: string; position?: string };
          return (item.title ?? item.role ?? item.position ?? "").trim();
        })
        .filter(Boolean)
    : [];
  return {
    headline: (data.headline ?? "").trim(),
    skills,
    experienceTitles,
    embedding: Array.isArray(p?.embedding) ? (p!.embedding as number[]) : null,
  };
}

const MAX_SEARCH_TITLES = 5;

/** Case-insensitive dedupe preserving order, dropping blanks. */
function dedupeTitles(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim();
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * The job titles that drive the search APIs, in strict priority order:
 *   1. the titles the user set in Settings (highest — their explicit intent);
 *   2. else the résumé HEADLINE only — one clean role, NOT the broader
 *      work-history titles, which pulled in roles the user didn't want;
 *   3. else nothing → the firehose is suspended (never guess at roles the
 *      user doesn't need).
 * The résumé is still used to score/rank results regardless.
 */
function searchTitlesFrom(roleQuery: string, master: MasterProfile): string[] {
  const explicit = roleQuery
    ? roleQuery.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
    : [];
  if (explicit.length) return dedupeTitles(explicit).slice(0, MAX_SEARCH_TITLES);
  if (master.headline) return [master.headline];
  return [];
}

async function buildScoreContext(
  db: Db,
  userId: string,
  targetCountryCodes: string[],
  familyPriority: boolean,
  master: { headline: string; skills: string[]; embedding: number[] | null },
  searchTitles: string[],
): Promise<ScoreContext> {
  const savedJobs = await db
    .select({ title: schema.jobs.title, embedding: schema.jobs.embedding })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.userId, userId), eq(schema.jobs.saved, true)))
    .limit(100);

  const learned = await db
    .select({ data: schema.learnedProfile.data })
    .from(schema.learnedProfile)
    .where(eq(schema.learnedProfile.userId, userId))
    .limit(1);
  const learnedTitles = ((learned[0]?.data as Record<string, string>) ?? {});
  const preferredTitles = [
    // the titles the user actually searched come first, so the score rewards
    // the role they asked for — not just their résumé/pipeline
    ...searchTitles,
    ...(master.headline ? [master.headline] : []),
    ...savedJobs.map((j) => j.title),
    ...(learnedTitles.preferred_titles ? learnedTitles.preferred_titles.split(",") : []),
    ...(learnedTitles.target_role ? [learnedTitles.target_role] : []),
  ];

  // The résumé embedding anchors scoring even before any job is saved.
  const profileEmbeddings = [
    ...(master.embedding ? [master.embedding] : []),
    ...savedJobs.map((j) => j.embedding as number[] | null).filter((e): e is number[] => Array.isArray(e)),
  ];

  return { targetCountryCodes, preferredTitles, profileEmbeddings, familyPriority };
}

export async function runDiscoveryForUser(db: Db, log: Logger, userId: string): Promise<{ found: number; sources: number }> {
  const settings = await db
    .select({
      targetCountries: schema.userSettings.targetCountries,
      roleQuery: schema.userSettings.roleQuery,
      requireSponsorship: schema.userSettings.requireSponsorship,
      requireFamilyReunification: schema.userSettings.requireFamilyReunification,
    })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);
  const targetCountries = ((settings[0]?.targetCountries as { code: string | null }[]) ?? [])
    .map((c) => c.code)
    .filter((c): c is string => Boolean(c));
  if (targetCountries.length === 0) return { found: 0, sources: 0 };
  const roleQuery = (settings[0]?.roleQuery ?? "").trim();
  const requireSponsorship = settings[0]?.requireSponsorship ?? true;
  const familyPriority = settings[0]?.requireFamilyReunification ?? true;

  const master = await loadMasterProfile(db, userId);
  const searchTitles = searchTitlesFrom(roleQuery, master);
  if (searchTitles.length)
    log.info(
      { user: userId, searchTitles, from: roleQuery ? "settings" : "resume-headline" },
      "discovery search titles",
    );
  else log.info({ user: userId }, "no titles and no résumé headline — discovery firehose suspended");

  const sources = await sourcesForCountries(db, targetCountries);
  const proxyUrl = await resolveProxyUrl(db);
  const providerKeys = await resolveProviderKeys(db);
  const sponsorIndex = await loadSponsorIndex(db, targetCountries);
  const embedder = await buildEmbedder(db, log);
  const scoreCtx = await buildScoreContext(
    db,
    userId,
    targetCountries,
    familyPriority,
    master,
    searchTitles,
  );

  // fetch each unique endpoint once per run
  const fetchCache = new Map<string, RawPosting[]>();
  // searchTitle is the exact title whose provider query produced this posting
  // (firehose only); it drives the role-relevance gate below. Company/ATS
  // source postings carry no searchTitle and skip that gate.
  const collected: { raw: RawPosting; searchTitle?: string }[] = [];

  for (const source of sources) {
    const ctx: FetchContext = {
      proxyUrl: source.proxyEnabled ? proxyUrl : null,
      log: (msg, extra) => log.info({ source: source.name, ...extra }, msg),
    };
    const cacheKey = `${source.type}:${JSON.stringify(source.config)}`;
    const startedAt = Date.now();
    try {
      let postings = fetchCache.get(cacheKey);
      if (!postings) {
        postings = await fetchSource(source, ctx);
        fetchCache.set(cacheKey, postings);
      }
      const query = source.config.query as string | undefined;
      const relevant = postings
        .filter((p) => matchesQuery(p, query))
        .filter(isFresh)
        // ATS boards list a company's GLOBAL jobs, so only keep roles the
        // adapter actually geolocated to this source's country. A posting
        // with no resolved country (e.g. "Remote — US") is ambiguous and was
        // leaking foreign roles (US) into the wrong country, so drop it here.
        .filter((p) => p.countryCode === source.countryCode)
        .slice(0, 60);
      for (const raw of relevant)
        collected.push({ raw, searchTitle: bestSearchTitle(raw.title, searchTitles) });
      await recordDiscoveryRun(db, {
        sourceId: source.id,
        sourceName: source.name,
        status: "success",
        fetched: relevant.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      log.warn({ source: source.name, err: (err as Error).message }, "source fetch failed");
      await recordDiscoveryRun(db, {
        sourceId: source.id,
        sourceName: source.name,
        status: "failed",
        fetched: 0,
        error: (err as Error).message.slice(0, 300),
        durationMs: Date.now() - startedAt,
      });
    }
  }

  // Country-driven firehose: query each enabled provider once per target
  // country PER search title. This is what makes discovery unrestricted —
  // postings come from every company advertising in the country, not a fixed
  // company list. Titles come from the user's role query (they can list
  // several to broaden the net), or their résumé when they haven't set one.
  for (const title of searchTitles) {
    for (const country of targetCountries) {
      for (const provider of PROVIDERS) {
        if (provider.needsKey && !providerKeys[provider.keyName]) continue;
        const startedAt = Date.now();
        try {
          const postings = await PROVIDER_ADAPTERS[provider.id]({
            countryCode: country,
            roleQuery: title,
            keys: providerKeys,
            log: (msg, extra) => log.info({ provider: provider.id, country, title, ...extra }, msg),
          });
          const relevant = postings
            .filter(isFresh)
            .filter(
              (p) =>
                p.countryCode === country ||
                (p.remote === "remote" && (p.countryCode === null || p.countryCode === country)),
            )
            .slice(0, 60);
          for (const raw of relevant) collected.push({ raw, searchTitle: title });
          await recordDiscoveryRun(db, {
            sourceId: null,
            sourceName: `${provider.label} · ${country} · ${title}`,
            status: "success",
            fetched: relevant.length,
            durationMs: Date.now() - startedAt,
          });
        } catch (err) {
          log.warn(
            { provider: provider.id, country, title, err: (err as Error).message },
            "provider fetch failed",
          );
          await recordDiscoveryRun(db, {
            sourceId: null,
            sourceName: `${provider.label} · ${country} · ${title}`,
            status: "failed",
            fetched: 0,
            error: (err as Error).message.slice(0, 300),
            durationMs: Date.now() - startedAt,
          });
        }
      }
    }
  }

  // embed the batch in one call where possible
  const texts = collected.map((c) => `${c.raw.title}\n${c.raw.description.slice(0, 1500)}`);
  const embeddings = texts.length > 0 ? await embedder.embed(texts) : [];
  // embed the searched titles once (title-only) so borderline firehose results
  // can be rescued by similarity to the role the user actually searched
  const titleEmbeddings = searchTitles.length > 0 ? await embedder.embed(searchTitles) : [];
  const titleVecs = titleEmbeddings.filter((e): e is number[] => Array.isArray(e));

  let found = 0;
  let offRoleDropped = 0;
  for (let i = 0; i < collected.length; i++) {
    const { raw } = collected[i];
    const embedding = embeddings[i] ?? null;
    const fp = fingerprint(raw);

    const dupId = await findDuplicate(db, userId, raw, fp, embedding);
    if (dupId) {
      // refresh freshness on the existing record, but never resurrect a saved one's stage
      await db
        .update(schema.jobs)
        .set({ postedAt: raw.postedAt ?? undefined, updatedAt: new Date() })
        .where(eq(schema.jobs.id, dupId));
      continue;
    }

    // Role-relevance gate (firehose only): the search APIs match the query
    // anywhere in a posting, so drop results whose TITLE doesn't match the
    // title the user actually searched. Clearly on-role titles pass the lexical
    // check; borderline ones are kept only when their embedding is close to the
    // searched role, so real synonyms ("Backend Engineer" for "Software
    // Engineer") survive while junk ("IT Support") is dropped.
    const searchTitle = collected[i].searchTitle;
    if (searchTitle) {
      const rel = titleRelevance(raw.title, searchTitle);
      if (!rel.strong) {
        let keep: boolean;
        if (embedding && titleVecs.length > 0) {
          const best = Math.max(...titleVecs.map((v) => cosine(embedding, v)));
          keep = best >= (embedder.provider === "openai" ? RESCUE_OPENAI : RESCUE_LOCAL);
        } else {
          // no usable embedding signal — fall back to a lenient lexical keep so
          // an embedding outage never silently empties Discover
          keep = rel.headPresent;
        }
        if (!keep) {
          offRoleDropped += 1;
          continue;
        }
      }
    }

    // A posting that explicitly denies sponsorship ("visa sponsorship is not
    // available for this role") is a pure time-waster for someone who requires
    // it — drop it outright, even if the employer is on the register. The
    // denial always wins over any positive signal.
    const denied = deniesSponsorship(raw.description);
    if (denied && requireSponsorship) continue;

    const signals = await detectSignals(db, userId, raw, fp);
    const sponsorMatch = matchSponsorIndexed(sponsorIndex, raw.companyName, raw.countryCode);

    // sponsorship tiers: confirmed from an official register, inferred from
    // the posting text, or inferred structurally in the Gulf where the
    // employer sponsors the residence visa by law. Otherwise unknown, which
    // the Discover gate hides by default in register countries. An explicit
    // denial forces "unknown" no matter what (never claim a role sponsors when
    // it says it does not).
    let sponsorship: "yes" | "inferred" | "unknown" = "unknown";
    if (denied) sponsorship = "unknown";
    else if (sponsorMatch.status === "confirmed") sponsorship = "yes";
    else if (mentionsSponsorship(raw.description)) sponsorship = "inferred";
    else if (isGulf(raw.countryCode)) sponsorship = "inferred";

    const score = scoreJob(raw, embedding, scoreCtx, sponsorship);

    const salary = parseSalary(raw.salaryRaw);

    await db.insert(schema.jobs).values({
      userId,
      title: raw.title,
      companyName: raw.companyName,
      location: raw.location,
      countryCode: raw.countryCode,
      remote: raw.remote,
      url: raw.url,
      source: raw.source,
      market: raw.market,
      description: raw.description,
      salaryRaw: raw.salaryRaw,
      salaryMin: salary.min !== null ? String(salary.min) : null,
      salaryMax: salary.max !== null ? String(salary.max) : null,
      salaryCurrency: salary.currency,
      salaryPeriod: salary.period,
      sponsorship,
      stage: "saved",
      saved: false,
      postedAt: raw.postedAt,
      externalId: raw.externalId,
      fingerprint: fp,
      signals: signals.length > 0 ? signals : null,
      matchScore: score.score,
      matchExplanation: score,
      embedding: embedding ?? undefined,
    });
    found += 1;
  }

  log.info(
    { user: userId, collected: collected.length, inserted: found, offRoleDropped },
    "discovery relevance gate",
  );

  return { found, sources: sources.length };
}
