import winkNLP, { type WinkMethods } from "wink-nlp";
import model from "wink-eng-lite-web-model";

/**
 * wink-nlp singleton plus the keyword, ATS-section, and culture-fit
 * engines built on top of it. Used by match scoring, the tailoring
 * constraint, ATS simulation, and culture-fit scoring.
 */

const g = globalThis as unknown as { __tpNlp?: WinkMethods };
function nlp(): WinkMethods {
  g.__tpNlp ??= winkNLP(model);
  return g.__tpNlp;
}

const EXTRA_STOP = new Set([
  "experience", "team", "work", "role", "years", "year", "ability", "strong", "good",
  "including", "using", "etc", "well", "new", "must", "will", "join", "looking", "candidate",
  "company", "business", "product", "customer", "customers", "responsibilities", "requirements",
  "opportunity", "environment", "growth", "world", "people", "day", "part", "plus", "skills",
]);

/**
 * Curated multi-word phrases that single-token extraction would split. Kept
 * broad and industry-agnostic — do NOT add occupation-specific vocabulary
 * here, or postings in that one field get unfairly boosted for every user.
 */
const TECH_PHRASES = [
  "machine learning", "deep learning", "data engineering", "data science", "product management",
  "ci cd", "ci/cd", "unit testing", "test automation", "project management", "customer success",
  "cloud infrastructure", "distributed systems",
  "rest api", "graphql", "micro services", "microservices", "event driven", "message queue",
];

export function extractKeywords(text: string, limit = 40): string[] {
  const doc = nlp().readDoc(text.slice(0, 40000));
  const its = nlp().its;
  const freq = new Map<string, number>();

  doc.tokens().each((t: { out: (f: unknown) => unknown }) => {
    const pos = String(t.out(its.pos));
    const normal = String(t.out(its.normal)).toLowerCase();
    if (!["NOUN", "PROPN"].includes(pos)) return;
    if (normal.length < 3 || normal.length > 40) return;
    if (EXTRA_STOP.has(normal)) return;
    if (!/^[a-z0-9][a-z0-9+.#/-]*$/.test(normal)) return;
    freq.set(normal, (freq.get(normal) ?? 0) + 1);
  });

  const lower = text.toLowerCase();
  for (const phrase of TECH_PHRASES) {
    if (lower.includes(phrase)) freq.set(phrase, (freq.get(phrase) ?? 0) + 2);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

export type KeywordGap = { covered: string[]; missing: string[]; coverage: number };

/** Which of the job's keywords the profile text covers. */
export function keywordGap(jobText: string, profileText: string): KeywordGap {
  const jobKeywords = extractKeywords(jobText, 35);
  const hay = profileText.toLowerCase();
  const covered: string[] = [];
  const missing: string[] = [];
  for (const kw of jobKeywords) {
    if (hay.includes(kw)) covered.push(kw);
    else missing.push(kw);
  }
  const coverage = jobKeywords.length > 0 ? covered.length / jobKeywords.length : 0;
  return { covered, missing, coverage };
}

export type AtsSections = {
  contact: boolean;
  summary: boolean;
  experience: boolean;
  education: boolean;
  skills: boolean;
};

/** Detects the standard CV sections an ATS looks for. */
export function detectSections(cvText: string): AtsSections {
  const t = cvText.toLowerCase();
  return {
    contact: /@[\w.-]+\.\w+/.test(t) || /\+?\d[\d\s()-]{7,}/.test(t),
    summary: /\b(summary|profile|objective|about)\b/.test(t),
    experience: /\b(experience|employment|work history|professional background)\b/.test(t),
    education: /\b(education|degree|university|bachelor|master|academic)\b/.test(t),
    skills: /\b(skills|technologies|technical|competenc|proficienc)\b/.test(t),
  };
}

const CULTURE_SIGNALS: { key: string; re: RegExp; label: string }[] = [
  { key: "collaborative", re: /\b(collaborat|cross-functional|team player|partner with|work closely)\b/i, label: "collaborative" },
  { key: "autonomous", re: /\b(autonom|ownership|self-starter|independent|take initiative)\b/i, label: "autonomy and ownership" },
  { key: "fastpaced", re: /\b(fast-paced|fast paced|move quickly|ship fast|high-growth|scale rapidly)\b/i, label: "fast-paced" },
  { key: "structured", re: /\b(process-driven|structured|rigorous|methodical|well-defined)\b/i, label: "structured and process-driven" },
  { key: "customer", re: /\b(customer-obsessed|customer-focused|user-centric|customer first)\b/i, label: "customer focus" },
  { key: "impact", re: /\b(impact|mission-driven|purpose|meaningful)\b/i, label: "mission and impact" },
];

export type CultureFit = { score: number; jobSignals: string[]; matched: string[]; note: string };

/** Scores how the posting's culture language lines up with the user's stated work style. */
export function cultureFit(jobText: string, workStyle: string): CultureFit {
  const jobSignals = CULTURE_SIGNALS.filter((s) => s.re.test(jobText));
  if (!workStyle.trim()) {
    return {
      score: 0,
      jobSignals: jobSignals.map((s) => s.label),
      matched: [],
      note: "Add your work style to the profile to score culture fit.",
    };
  }
  const matched = jobSignals.filter((s) => s.re.test(workStyle));
  const score =
    jobSignals.length > 0 ? Math.round((matched.length / jobSignals.length) * 100) : 50;
  const note =
    jobSignals.length === 0
      ? "The posting says little about culture."
      : matched.length === jobSignals.length
        ? "The posting's culture language matches your stated style well."
        : matched.length > 0
          ? "Partial overlap between the posting's culture and your style."
          : "The posting emphasizes a style different from yours, worth a closer look.";
  return { score, jobSignals: jobSignals.map((s) => s.label), matched: matched.map((s) => s.label), note };
}
