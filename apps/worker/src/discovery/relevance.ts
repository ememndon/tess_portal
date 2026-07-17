import { normalize } from "./dedup";

/**
 * Role-relevance gate for firehose results. The provider APIs (Careerjet,
 * Adzuna, JSearch) match the searched words anywhere in a posting's
 * title + description, so they return many off-role jobs. This checks a job
 * TITLE against the exact title the user searched, using the same normalize()
 * as dedup (which already strips seniority words like senior/lead/principal)
 * plus a small synonym map — so a "Software Engineer" search keeps "Backend
 * Engineer" but drops "IT Support". Borderline titles are handed to an
 * embedding rescue in the caller, so this only needs to separate "clearly
 * on-role" from "needs a second look".
 */

// Equivalence groups: tokens that count as the same role word. Kept small and
// high-signal. Seniority words (senior/junior/lead/principal/staff/…) are
// already removed by normalize(), so they never appear here.
const SYNONYM_GROUPS: string[][] = [
  ["engineer", "developer", "dev", "programmer", "swe", "engineering"],
  ["scientist", "science"],
  ["analyst", "analytics", "analysis"],
  ["designer", "design"],
  ["architect", "architecture"],
  ["administrator", "admin", "administration"],
  ["accountant", "accounting", "accounts"],
  ["marketer", "marketing"],
  ["recruiter", "recruitment", "recruiting"],
  ["manager", "management"],
];

const SYNONYMS = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    const set = SYNONYMS.get(word) ?? new Set<string>();
    for (const other of group) set.add(other);
    SYNONYMS.set(word, set);
  }
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

export type TitleRelevance = { strong: boolean; headPresent: boolean; coverage: number };

/**
 * How well a job title matches the searched title:
 *  - strong: the head noun (last word, e.g. "engineer") or a synonym is
 *    present AND at least 60% of the searched words are present.
 *  - headPresent / coverage let the caller apply an embedding rescue to
 *    non-strong-but-plausible titles.
 * An empty searched title can't be judged, so it passes (never blocks).
 */
export function titleRelevance(jobTitle: string, searchTitle: string): TitleRelevance {
  const search = tokens(searchTitle);
  if (search.length === 0) return { strong: true, headPresent: true, coverage: 1 };
  const jobTokens = new Set(tokens(jobTitle));
  const present = (tok: string): boolean => {
    if (jobTokens.has(tok)) return true;
    const syn = SYNONYMS.get(tok);
    if (syn) for (const s of syn) if (jobTokens.has(s)) return true;
    return false;
  };
  const head = search[search.length - 1];
  const headPresent = present(head);
  const hits = search.filter(present).length;
  const coverage = hits / search.length;
  return { strong: headPresent && coverage >= 0.6, headPresent, coverage };
}
