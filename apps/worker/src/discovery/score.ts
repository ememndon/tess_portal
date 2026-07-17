import { cosine } from "./embed";
import { normalize } from "./dedup";
import { familyReunificationFor } from "./countries";
import type { RawPosting } from "./types";

/**
 * Fit scoring for discovery. The score draws on: target country match,
 * visa sponsorship (the user's hard requirement, weighted heavily),
 * family-reunification friendliness of the country, keyword overlap
 * with the user's pipeline and preferred titles, freshness, and
 * embedding similarity to the user's pipeline when vectors exist. The
 * explanation is plain language so the number is never a black box.
 */

export type ScoreContext = {
  targetCountryCodes: string[];
  preferredTitles: string[]; // pipeline titles + learned preferred titles
  profileEmbeddings: number[][]; // embeddings of the user's saved jobs, if any
  /** rank family-reunification-friendly countries higher (user toggle) */
  familyPriority: boolean;
};

export type MatchExplanation = { score: number; reasons: string[] };

export function scoreJob(
  raw: RawPosting,
  embedding: number[] | null,
  ctx: ScoreContext,
  /** resolved sponsorship tier from register / text / Gulf rules */
  sponsorship: "yes" | "inferred" | "unknown",
): MatchExplanation {
  const reasons: string[] = [];
  let score = 40; // neutral base

  // country
  if (raw.countryCode && ctx.targetCountryCodes.includes(raw.countryCode)) {
    score += 20;
    reasons.push(`In ${raw.countryCode}, one of your target countries`);
  } else if (raw.remote === "remote") {
    // remote roles outside a target country rarely sponsor a work visa, so they
    // are not boosted (in-country roles, incl. in-country remote, get +20 above)
    reasons.push("Remote role (limited visa sponsorship)");
  } else if (raw.countryCode) {
    score -= 10;
    reasons.push(`In ${raw.countryCode}, outside your target countries`);
  }

  // visa sponsorship: the user's hard requirement, so it moves the score a lot
  if (sponsorship === "yes") {
    score += 18;
    reasons.push("Employer can sponsor a work visa");
  } else if (sponsorship === "inferred") {
    score += 10;
    reasons.push("Sponsorship likely for this role or country");
  }

  // family reunification, when the user is prioritising it
  if (ctx.familyPriority) {
    const family = familyReunificationFor(raw.countryCode);
    if (family === "yes") {
      score += 12;
      reasons.push("Country supports bringing your family");
    } else if (family === "income-gated") {
      score += 6;
      reasons.push("Family reunification available above an income threshold");
    } else if (family === "limited") {
      score += 3;
      reasons.push("Family visas available for higher-paid roles");
    }
  }

  // keyword overlap with preferred titles
  const jobTokens = new Set(normalize(raw.title).split(" ").filter(Boolean));
  let bestOverlap = 0;
  for (const t of ctx.preferredTitles) {
    const tks = normalize(t).split(" ").filter(Boolean);
    if (tks.length === 0) continue;
    const hits = tks.filter((tk) => jobTokens.has(tk)).length;
    bestOverlap = Math.max(bestOverlap, hits / tks.length);
  }
  if (bestOverlap > 0) {
    const pts = Math.round(bestOverlap * 22);
    score += pts;
    if (bestOverlap >= 0.5) reasons.push("Title closely matches roles you are pursuing");
    else reasons.push("Title partly overlaps with your target roles");
  }

  // embedding similarity to pipeline
  if (embedding && ctx.profileEmbeddings.length > 0) {
    const best = Math.max(...ctx.profileEmbeddings.map((e) => cosine(embedding, e)));
    if (best > 0.5) {
      const pts = Math.round((best - 0.5) * 40);
      score += pts;
      if (best > 0.75) reasons.push("Very similar to jobs already in your pipeline");
    }
  }

  // freshness
  if (raw.postedAt) {
    const days = (Date.now() - raw.postedAt.getTime()) / 86400000;
    if (days <= 3) {
      score += 4;
      reasons.push("Posted in the last few days");
    } else if (days > 45) {
      score -= 6;
      reasons.push("Posting is over six weeks old");
    }
  }

  score = Math.max(1, Math.min(99, Math.round(score)));
  if (reasons.length === 0) reasons.push("Scored on country and title fit");
  return { score, reasons };
}
