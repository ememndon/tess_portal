import { profileToText } from "@/lib/match/score";
import { confirmedSkillSet, type Profile } from "@/lib/cv/schema";

/**
 * The skill lexicon and the enforcement primitives for the
 * no-unconfirmed-claim constraint. A tailored document may only assert
 * a technology or skill the confirmed profile backs. We recognize a
 * "skill claim" by a curated lexicon of technologies, so ordinary prose
 * ("platform", "team") is never mistaken for a claim, and we catch an
 * injected skill whether or not the job posting mentioned it.
 *
 * Ambiguous one or two letter names (go, r, c) are deliberately omitted
 * to avoid matching common words; their unambiguous forms are included.
 */
export const SKILL_LEXICON: string[] = [
  // languages
  "typescript", "javascript", "python", "java", "kotlin", "scala", "golang", "rust", "ruby",
  "php", "swift", "objective-c", "c++", "c#", "cobol", "fortran", "perl", "elixir", "erlang",
  "haskell", "clojure", "dart", "lua", "matlab", "sql", "pl/sql", "t-sql", "bash", "powershell",
  "solidity", "groovy", "visual basic", "vba", "assembly",
  // frontend
  "react", "angular", "vue", "svelte", "next.js", "nuxt", "redux", "tailwind", "webpack", "vite",
  "jquery", "ember", "backbone", "gatsby", "remix", "html", "css", "sass",
  // backend / frameworks
  "node.js", "express", "nestjs", "django", "flask", "fastapi", "rails", "laravel", "spring",
  "spring boot", "dotnet", ".net", "asp.net", "graphql", "grpc", "rest", "phoenix", "gin",
  // data / db
  "postgresql", "postgres", "mysql", "mongodb", "redis", "cassandra", "dynamodb", "elasticsearch",
  "kafka", "rabbitmq", "snowflake", "bigquery", "redshift", "databricks", "spark", "hadoop",
  "airflow", "dbt", "clickhouse", "neo4j", "sqlite", "oracle", "mssql", "db2", "cics", "jcl",
  // cloud / infra
  "aws", "azure", "gcp", "kubernetes", "docker", "terraform", "ansible", "pulumi", "helm",
  "jenkins", "gitlab ci", "github actions", "circleci", "prometheus", "grafana", "datadog",
  "nginx", "kafka", "istio", "vault", "consul", "cloudformation", "serverless", "lambda",
  // ml / data science
  "tensorflow", "pytorch", "keras", "scikit-learn", "pandas", "numpy", "huggingface", "langchain",
  "opencv", "spacy", "xgboost",
  // mobile
  "android", "ios", "flutter", "react native", "xamarin", "swiftui",
  // practices / tools
  "ci/cd", "microservices", "graphql", "figma", "jira", "kubernetes", "playwright", "cypress",
  "selenium", "jest", "pytest", "junit",
  // NOTE: this is a general recognition vocabulary only, not the source of
  // truth for any user's field. A user's actual skills are read from their own
  // résumé (confirmedSkillSet); do NOT special-case any single industry here.
];

const LEX_SET = new Set(SKILL_LEXICON);

/** Word-boundary presence that respects tech punctuation (+, #, ., /). */
export function containsSkill(text: string, skill: string): boolean {
  const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i").test(text);
}

/** True when the confirmed profile backs this skill term. */
export function profileHasSkill(profile: Profile, skill: string): boolean {
  const s = skill.toLowerCase();
  if (confirmedSkillSet(profile).has(s)) return true;
  return containsSkill(profileToText(profile), skill);
}

/**
 * Lexicon skills asserted in `text` that the confirmed profile does not
 * back. This is the definition of an unconfirmed claim, independent of
 * what the job posting asked for.
 */
export function unconfirmedSkillsIn(text: string, profile: Profile): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const skill of LEX_SET) {
    if (containsSkill(text, skill) && !profileHasSkill(profile, skill)) found.push(skill);
  }
  return [...new Set(found)];
}

/** Removes sentences that assert an unconfirmed skill. */
export function stripUnconfirmed(text: string, profile: Profile): { clean: string; removed: string[] } {
  if (!text) return { clean: "", removed: [] };
  const removed: string[] = [];
  const kept = text.split(/(?<=[.!?])\s+/).filter((sentence) => {
    const bad = unconfirmedSkillsIn(sentence, profile);
    if (bad.length > 0) {
      removed.push(...bad);
      return false;
    }
    return true;
  });
  return { clean: kept.join(" ").trim(), removed: [...new Set(removed)] };
}
