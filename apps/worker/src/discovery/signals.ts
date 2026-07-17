import { and, eq, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { RawPosting } from "./types";

/**
 * Ghost-job and scam detection v1. Repost patterns come from matching
 * fingerprints already seen with older posting dates. Red-flag
 * heuristics scan the posting text. Everything is labeled as a signal,
 * never a verdict.
 */

export type Signal = { type: string; label: string; severity: "info" | "warn" };

const RED_FLAGS: { re: RegExp; label: string; severity: "info" | "warn" }[] = [
  { re: /\b(registration|application|processing|training)\s+fee\b/i, label: "Mentions a fee to apply, a common scam sign", severity: "warn" },
  { re: /\b(pay|send)\s+.{0,20}\bupfront\b/i, label: "Asks for an upfront payment", severity: "warn" },
  { re: /\bwire\s+transfer\b|\bwestern union\b|\bgift card\b/i, label: "Mentions untraceable payment methods", severity: "warn" },
  { re: /\bearn\s+\$?\d{3,}\s*(?:\/|per)\s*(?:day|week)\b/i, label: "Unusually high advertised pay", severity: "warn" },
  { re: /@(?:gmail|yahoo|hotmail|outlook)\.com/i, label: "Contact is a personal email, not a company domain", severity: "info" },
  { re: /\b(no experience|anyone can|immediate start|urgent(?:ly)? (?:hiring|needed))\b/i, label: "Urgency or no-experience language", severity: "info" },
];

export async function detectSignals(
  db: Db,
  userId: string,
  raw: RawPosting,
  fingerprint: string,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const text = `${raw.title} ${raw.description}`;

  for (const flag of RED_FLAGS) {
    if (flag.re.test(text)) signals.push({ type: "red_flag", label: flag.label, severity: flag.severity });
  }

  if (!raw.salaryRaw && raw.description.length < 400) {
    signals.push({ type: "thin", label: "No salary and a very short description", severity: "info" });
  }

  // repost pattern: same fingerprint seen before with an older date
  const priors = await db
    .select({ postedAt: schema.jobs.postedAt, createdAt: schema.jobs.createdAt })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.userId, userId),
        eq(schema.jobs.fingerprint, fingerprint),
        raw.externalId ? ne(schema.jobs.externalId, raw.externalId) : sql`true`,
      ),
    );
  if (priors.length >= 1) {
    const oldest = priors
      .map((p) => p.postedAt ?? p.createdAt)
      .filter(Boolean)
      .sort((a, b) => (a as Date).getTime() - (b as Date).getTime())[0];
    const days = oldest ? Math.round((Date.now() - (oldest as Date).getTime()) / 86400000) : 0;
    signals.push({
      type: "repost",
      label: days > 0 ? `Reposted, first seen about ${days} day${days === 1 ? "" : "s"} ago` : "Seen before under a different listing",
      severity: days > 45 ? "warn" : "info",
    });
  }

  return signals;
}
