import { keywordGap } from "@/lib/analysis/nlp";
import type { Profile } from "@/lib/cv/schema";

/**
 * Combined match score: embedding similarity plus the wink-nlp keyword
 * gap, one number with a plain-language explanation of both parts, so
 * the score is never a black box.
 */

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function profileToText(profile: Profile): string {
  return [
    profile.headline,
    profile.summary,
    profile.skills.join(", "),
    profile.experience.map((e) => `${e.role} at ${e.company}. ${e.bullets.join(" ")}`).join(" "),
    profile.projects.map((p) => `${p.name}: ${p.description} ${p.tech.join(" ")}`).join(" "),
    profile.certifications.map((c) => c.name).join(", "),
  ]
    .filter(Boolean)
    .join("\n");
}

export type MatchResult = {
  score: number;
  embeddingScore: number | null;
  keywordCoverage: number;
  covered: string[];
  missing: string[];
  reasons: string[];
};

export function matchScore(input: {
  profile: Profile;
  jobText: string;
  jobEmbedding: number[] | null;
  profileEmbedding: number[] | null;
}): MatchResult {
  const profileText = profileToText(input.profile);
  const gap = keywordGap(input.jobText, profileText);

  const embSim =
    input.jobEmbedding && input.profileEmbedding
      ? Math.max(0, cosine(input.jobEmbedding, input.profileEmbedding))
      : null;

  // combine: when both signals exist, weight them evenly; otherwise use
  // whichever is available
  let combined: number;
  if (embSim !== null) {
    combined = 0.5 * embSim + 0.5 * gap.coverage;
  } else {
    combined = gap.coverage;
  }
  const score = Math.max(1, Math.min(99, Math.round(combined * 100)));

  const reasons: string[] = [];
  if (embSim !== null) {
    reasons.push(
      embSim > 0.6
        ? `Your profile is a strong semantic match for this role (${Math.round(embSim * 100)}% similarity).`
        : embSim > 0.4
          ? `Your profile is a moderate semantic match (${Math.round(embSim * 100)}% similarity).`
          : `Your profile is a weak semantic match (${Math.round(embSim * 100)}% similarity).`,
    );
  } else {
    reasons.push("Semantic scoring is unavailable, using keyword coverage only.");
  }
  reasons.push(
    `You cover ${gap.covered.length} of ${gap.covered.length + gap.missing.length} key terms in the posting (${Math.round(gap.coverage * 100)}%).`,
  );
  if (gap.missing.length > 0) {
    reasons.push(`Missing from your profile: ${gap.missing.slice(0, 8).join(", ")}.`);
  }

  return {
    score,
    embeddingScore: embSim,
    keywordCoverage: gap.coverage,
    covered: gap.covered,
    missing: gap.missing,
    reasons,
  };
}
