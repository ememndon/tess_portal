import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { ATS_ADAPTERS } from "./adapters/ats";
import { fingerprint, findDuplicate } from "./dedup";
import { buildEmbedder } from "./embed";
import { parseSalary } from "./normalize";
import type { FetchContext, RawPosting } from "./types";

/**
 * Company watchlist monitoring with careers-page ATS detection. For a
 * watched company with a website, probe the common ATS platforms for a
 * matching board; when found, monitor it and surface new postings as
 * discovered candidates. New postings appear within one monitoring
 * cycle.
 */

function slugFromWebsite(website: string | null, name: string): string {
  if (website) {
    try {
      const host = new URL(website).hostname.replace(/^www\./, "");
      return host.split(".")[0];
    } catch {
      // fall through to name
    }
  }
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Probes ATS platforms for a company slug, returns the first that answers with jobs. */
async function detectAts(slug: string, ctx: FetchContext): Promise<{ adapter: string; config: Record<string, unknown> } | null> {
  const probes: { adapter: string; config: Record<string, unknown> }[] = [
    { adapter: "greenhouse", config: { adapter: "greenhouse", board: slug } },
    { adapter: "lever", config: { adapter: "lever", company: slug } },
    { adapter: "ashby", config: { adapter: "ashby", board: slug } },
    { adapter: "recruitee", config: { adapter: "recruitee", company: slug } },
    { adapter: "workable", config: { adapter: "workable", account: slug } },
  ];
  for (const p of probes) {
    try {
      const postings = await ATS_ADAPTERS[p.adapter](p.config, ctx);
      if (postings.length > 0) return p;
    } catch {
      // this platform is not it, try the next
    }
  }
  return null;
}

export async function monitorWatchlists(db: Db, log: Logger): Promise<string> {
  const watched = await db
    .select({
      userId: schema.companyWatchlist.userId,
      companyId: schema.companies.id,
      name: schema.companies.name,
      website: schema.companies.website,
      brief: schema.companies.brief,
    })
    .from(schema.companyWatchlist)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.companyWatchlist.companyId));

  if (watched.length === 0) return "no watched companies";

  const embedder = await buildEmbedder(db, log);
  let newPostings = 0;

  for (const w of watched) {
    const ctx: FetchContext = { proxyUrl: null, log: () => {} };
    const slug = slugFromWebsite(w.website, w.name);
    const brief = (w.brief as { ats?: { adapter: string; config: Record<string, unknown> } } | null) ?? null;
    let ats = brief?.ats ?? null;
    if (!ats) {
      const detected = await detectAts(slug, ctx);
      if (detected) {
        ats = detected;
        await db
          .update(schema.companies)
          .set({ brief: { ...(w.brief as object), ats: detected }, updatedAt: new Date() })
          .where(eq(schema.companies.id, w.companyId));
      }
    }
    if (!ats) continue;

    let postings: RawPosting[] = [];
    try {
      postings = await ATS_ADAPTERS[String(ats.config.adapter)](ats.config, ctx);
    } catch (err) {
      log.warn({ company: w.name, err: (err as Error).message }, "watchlist fetch failed");
      continue;
    }

    for (const raw of postings.slice(0, 40)) {
      const fp = fingerprint(raw);
      const dup = await findDuplicate(db, w.userId, raw, fp, null);
      if (dup) continue;
      const embedding = (await embedder.embed([`${raw.title}\n${raw.description.slice(0, 1500)}`]))[0] ?? null;
      const salary = parseSalary(raw.salaryRaw);
      await db.insert(schema.jobs).values({
        userId: w.userId,
        companyId: w.companyId,
        title: raw.title,
        companyName: w.name,
        location: raw.location,
        countryCode: raw.countryCode,
        remote: raw.remote,
        url: raw.url,
        source: `watch:${raw.source}`,
        market: raw.market,
        description: raw.description,
        salaryRaw: raw.salaryRaw,
        salaryMin: salary.min !== null ? String(salary.min) : null,
        salaryMax: salary.max !== null ? String(salary.max) : null,
        salaryCurrency: salary.currency,
        salaryPeriod: salary.period,
        stage: "saved",
        saved: false,
        postedAt: raw.postedAt,
        externalId: raw.externalId,
        fingerprint: fp,
        embedding: embedding ?? undefined,
      });
      newPostings += 1;
      await db.insert(schema.signals).values({
        userId: w.userId,
        companyId: w.companyId,
        type: "new_posting",
        payload: { title: raw.title, url: raw.url },
      });
    }
  }

  return newPostings > 0 ? `${newPostings} new posting${newPostings === 1 ? "" : "s"} from watched companies` : "no new postings";
}
