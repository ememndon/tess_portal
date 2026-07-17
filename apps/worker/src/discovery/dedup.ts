import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import { cosine } from "./embed";
import type { RawPosting } from "./types";

/**
 * Deduplication. A stable fingerprint of normalized title plus company
 * catches the same role from two sources. pg_trgm similarity catches
 * near-identical titles at the same company, and embedding cosine
 * catches semantic duplicates when vectors are available.
 */

const STOP = /\b(senior|junior|lead|principal|staff|sr|jr|mid|the|a|an|of|for|and|remote|hybrid|onsite|m\/f\/d|m\/w\/d)\b/gi;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(STOP, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint(raw: Pick<RawPosting, "title" | "companyName">): string {
  return `${normalize(raw.title)}|${normalize(raw.companyName)}`;
}

/**
 * Returns the id of an existing job that duplicates `raw` for this
 * user, or null. Checks external id, fingerprint, trigram title match
 * at the same company, then embedding cosine.
 */
export async function findDuplicate(
  db: Db,
  userId: string,
  raw: RawPosting,
  fp: string,
  embedding: number[] | null,
): Promise<string | null> {
  const jobs = schema.jobs;

  if (raw.externalId) {
    const byExt = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.externalId, raw.externalId)))
      .limit(1);
    if (byExt[0]) return byExt[0].id;
  }

  const byFp = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.fingerprint, fp)))
    .limit(1);
  if (byFp[0]) return byFp[0].id;

  // trigram: same company AND a near-identical title. Thresholds are
  // deliberately strict so distinct roles at the same company (many
  // "Solutions Architect - X" variants) are NOT collapsed into one.
  const normCompany = normalize(raw.companyName);
  const trgm = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        sql`similarity(lower(${jobs.companyName}), ${normCompany}) > 0.8`,
        sql`similarity(${jobs.title}, ${raw.title}) > 0.9`,
      ),
    )
    .limit(1);
  if (trgm[0]) return trgm[0].id;

  if (embedding) {
    // embedding dedup only within the same company and only at very high
    // similarity, so it catches a genuine re-listing, not a sibling role
    const candidates = await db
      .select({ id: jobs.id, embedding: jobs.embedding, title: jobs.title })
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, userId),
          sql`similarity(lower(${jobs.companyName}), ${normCompany}) > 0.8`,
          sql`${jobs.embedding} is not null`,
        ),
      )
      .orderBy(sql`${jobs.embedding} <=> ${JSON.stringify(embedding)}::vector`)
      .limit(3);
    for (const c of candidates) {
      if (c.embedding && cosine(embedding, c.embedding as number[]) > 0.985) return c.id;
    }
  }

  return null;
}
