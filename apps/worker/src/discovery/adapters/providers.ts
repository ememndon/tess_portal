import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import { decryptSecret } from "@tessportal/shared";
import { politeFetch } from "../fetch";
import { isRemote, marketFor } from "../countries";
import { looksForeign } from "../geo";
import type { RawPosting } from "../types";

/**
 * Country-driven provider adapters — the firehose that makes discovery
 * unrestricted. Unlike the per-company ATS adapters, these search a whole
 * country for a role, so postings come from every company advertising
 * there, not a fixed list. Each provider is queried once per target
 * country per run.
 *
 * Providers and coverage (verified 2026-07-09):
 *  - Careerjet: all 10 target countries. Free API key (v4 Access API). Backbone.
 *  - Adzuna:    GB, AU, CA, NL, NZ only. Free app_id + app_key. Salary data.
 *  - JSearch:   all 10 (Google-for-Jobs). Free RapidAPI key, 200 req/mo.
 *  - Jooble:    all target countries incl. Ireland (which Adzuna lacks). Free key.
 *  - Reed:      United Kingdom only. Deep UK inventory. Free self-service key.
 * SmartRecruiters has no public global cross-company search, so it is not
 * a firehose provider (watchlisted companies still deep-read their board).
 */

const UA = "Mozilla/5.0 (compatible; TessPortal/1.0; +https://career.tessconsole.cloud)";

// Careerjet's v4 API still requires a caller IP; the worker has no end user
// so the server's declared public egress IP is used (must be declared in the
// Careerjet dashboard's Server IP addresses tab, or calls are rejected).
const SERVER_IP = process.env.PUBLIC_EGRESS_IP ?? "185.28.22.66";
// v4 also rejects calls whose Referer does not match the account's declared
// site, so every Careerjet request carries the app's public origin.
const CAREERJET_REFERER = process.env.PUBLIC_APP_URL ?? "https://career.tessconsole.cloud/";

export type ProviderKeys = Record<string, string | null>;

export type ProviderArgs = {
  countryCode: string;
  roleQuery: string;
  keys: ProviderKeys;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

export type ProviderAdapter = (args: ProviderArgs) => Promise<RawPosting[]>;

export type ProviderMeta = { id: string; label: string; needsKey: boolean; keyName: string };

/** Registered firehose providers, tried in order per country. */
export const PROVIDERS: ProviderMeta[] = [
  { id: "careerjet", label: "Careerjet", needsKey: true, keyName: "careerjet" },
  { id: "adzuna", label: "Adzuna", needsKey: true, keyName: "adzuna" },
  { id: "jsearch", label: "JSearch", needsKey: true, keyName: "jsearch" },
  { id: "jooble", label: "Jooble", needsKey: true, keyName: "jooble" },
  { id: "reed", label: "Reed", needsKey: true, keyName: "reed" },
];

/**
 * Loads the provider API keys from the vault (platform scope, kind
 * platform_api_key). Careerjet holds the affid, JSearch the RapidAPI key,
 * Adzuna a JSON string {app_id, app_key}. Missing keys resolve to null so
 * the run loop simply skips that provider.
 */
export async function resolveProviderKeys(db: Db): Promise<ProviderKeys> {
  const out: ProviderKeys = {};
  for (const p of PROVIDERS) out[p.keyName] = null;
  const master = process.env.VAULT_MASTER_KEY;
  if (!master) return out;
  const wanted = new Set(PROVIDERS.map((p) => p.keyName));
  const rows = await db
    .select({ name: schema.vaultSecrets.name, ciphertext: schema.vaultSecrets.ciphertext })
    .from(schema.vaultSecrets)
    .where(
      and(isNull(schema.vaultSecrets.userId), eq(schema.vaultSecrets.kind, "platform_api_key")),
    );
  for (const r of rows) {
    if (!wanted.has(r.name)) continue;
    try {
      out[r.name] = decryptSecret(master, r.ciphertext);
    } catch {
      out[r.name] = null;
    }
  }
  return out;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Reed returns posted dates as "dd/MM/yyyy", which Date can't parse directly.
function parseReedDate(value: string | undefined): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return safeDate(value);
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const COUNTRY_NAME: Record<string, string> = {
  IE: "Ireland",
  NL: "Netherlands",
  NZ: "New Zealand",
  NO: "Norway",
  CA: "Canada",
  GB: "United Kingdom",
  AU: "Australia",
  AE: "United Arab Emirates",
  QA: "Qatar",
  SA: "Saudi Arabia",
};

/* ---------- Careerjet (all 10 countries) ---------- */

const CAREERJET: Record<string, { locale: string; location: string }> = {
  IE: { locale: "en_IE", location: "Ireland" },
  NL: { locale: "nl_NL", location: "Netherlands" },
  NZ: { locale: "en_NZ", location: "New Zealand" },
  NO: { locale: "no_NO", location: "Norway" },
  CA: { locale: "en_CA", location: "Canada" },
  GB: { locale: "en_GB", location: "United Kingdom" },
  AU: { locale: "en_AU", location: "Australia" },
  AE: { locale: "en_AE", location: "United Arab Emirates" },
  QA: { locale: "en_QA", location: "Qatar" },
  SA: { locale: "en_SA", location: "Saudi Arabia" },
};

type CareerjetJob = {
  title?: string;
  description?: string;
  company?: string;
  locations?: string;
  url?: string;
  salary?: string;
  date?: string;
};

const careerjet: ProviderAdapter = async ({ countryCode, roleQuery, keys, log }) => {
  const apiKey = keys.careerjet;
  const cfg = CAREERJET[countryCode];
  if (!apiKey || !cfg) return [];
  const params = new URLSearchParams({
    keywords: roleQuery,
    // locale_code pins the country + language; leave location empty for a
    // nationwide sweep across every company advertising there
    locale_code: cfg.locale,
    sort: "date",
    page: "1",
    page_size: "50",
    // v4 still requires a caller ip + ua even server-side
    user_ip: SERVER_IP,
    user_agent: UA,
  });
  // v4 Access API: HTTPS, HTTP Basic auth with the API key as the username
  // and an empty password.
  const auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  const res = await politeFetch(`https://search.api.careerjet.net/v4/query?${params.toString()}`, {
    headers: { Authorization: auth, Referer: CAREERJET_REFERER },
  });
  if (!res.ok) throw new Error(`careerjet ${countryCode} -> ${res.status}`);
  const data = (await res.json()) as { type?: string; jobs?: CareerjetJob[] };
  // v4 answers with type "LOCATIONS" (ambiguous location) or an error type
  // instead of jobs; only "JOBS" carries the results array.
  if (data.type !== "JOBS" || !Array.isArray(data.jobs)) {
    if (data.type && data.type !== "JOBS") log("careerjet non-jobs response", { type: data.type });
    return [];
  }
  return data.jobs
    .filter((j) => j.url && j.title)
    .map((j) => ({
      // v4 returns no id; the path of the tracking url is the stable part
      externalId: `cj:${(j.url as string).split("?")[0]}`,
      title: j.title!,
      companyName: j.company ?? "",
      location: j.locations ?? null,
      countryCode,
      remote: isRemote(j.locations, j.description),
      url: j.url!,
      description: stripTags(j.description ?? ""),
      salaryRaw: j.salary ?? null,
      postedAt: safeDate(j.date),
      source: "careerjet",
      market: marketFor(countryCode),
    }));
};

/* ---------- Adzuna (GB, AU, CA, NL, NZ) ---------- */

const ADZUNA_COUNTRY: Record<string, string> = { GB: "gb", AU: "au", CA: "ca", NL: "nl", NZ: "nz" };

type AdzunaJob = {
  id?: string;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url?: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  created?: string;
};

const adzuna: ProviderAdapter = async ({ countryCode, roleQuery, keys }) => {
  const raw = keys.adzuna;
  const cc = ADZUNA_COUNTRY[countryCode];
  if (!raw || !cc) return [];
  let creds: { app_id?: string; app_key?: string };
  try {
    creds = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!creds.app_id || !creds.app_key) return [];
  const params = new URLSearchParams({
    app_id: creds.app_id,
    app_key: creds.app_key,
    what: roleQuery,
    results_per_page: "50",
    sort_by: "date",
    "content-type": "application/json",
  });
  const res = await politeFetch(
    `https://api.adzuna.com/v1/api/jobs/${cc}/search/1?${params.toString()}`,
    {},
  );
  if (!res.ok) throw new Error(`adzuna ${countryCode} -> ${res.status}`);
  const data = (await res.json()) as { results?: AdzunaJob[] };
  return (data.results ?? [])
    .filter((j) => j.redirect_url && j.title)
    .map((j) => {
      const parts: string[] = [];
      if (j.salary_min) parts.push(String(Math.round(j.salary_min)));
      if (j.salary_max && j.salary_max !== j.salary_min) parts.push(String(Math.round(j.salary_max)));
      const salaryRaw = parts.length
        ? `${parts.join(" - ")} ${marketFor(countryCode) ?? ""}`.trim()
        : null;
      return {
        externalId: `az:${cc}:${j.id ?? j.redirect_url}`,
        title: j.title!,
        companyName: j.company?.display_name ?? "",
        location: j.location?.display_name ?? null,
        countryCode,
        remote: isRemote(j.location?.display_name, j.description),
        url: j.redirect_url!,
        description: stripTags(j.description ?? ""),
        salaryRaw,
        postedAt: safeDate(j.created),
        source: "adzuna",
        market: marketFor(countryCode),
      };
    });
};

/* ---------- JSearch / Google-for-Jobs (all 10) ---------- */

const JSEARCH_COUNTRY: Record<string, string> = {
  IE: "ie",
  NL: "nl",
  NZ: "nz",
  NO: "no",
  CA: "ca",
  GB: "gb",
  AU: "au",
  AE: "ae",
  QA: "qa",
  SA: "sa",
};

type JSearchJob = {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_apply_link?: string;
  job_description?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_period?: string;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
};

const jsearch: ProviderAdapter = async ({ countryCode, roleQuery, keys }) => {
  const key = keys.jsearch;
  const cc = JSEARCH_COUNTRY[countryCode];
  if (!key || !cc) return [];
  const params = new URLSearchParams({
    query: `${roleQuery} in ${COUNTRY_NAME[countryCode] ?? countryCode}`,
    country: cc,
    page: "1",
    num_pages: "1",
    date_posted: "month",
  });
  // JSearch v5 renamed the search endpoint to /search-v2 and nests results
  // under data.jobs (with a cursor for paging). The per-job fields are unchanged.
  const res = await politeFetch(`https://jsearch.p.rapidapi.com/search-v2?${params.toString()}`, {
    headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`jsearch ${countryCode} -> ${res.status} ${errBody.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: { jobs?: JSearchJob[] } };
  return (data.data?.jobs ?? [])
    .filter((j) => j.job_apply_link && j.job_title)
    .map((j) => {
      const parts: string[] = [];
      if (j.job_min_salary) parts.push(String(Math.round(j.job_min_salary)));
      if (j.job_max_salary && j.job_max_salary !== j.job_min_salary)
        parts.push(String(Math.round(j.job_max_salary)));
      const salaryRaw = parts.length
        ? `${parts.join(" - ")}${j.job_salary_period ? ` /${j.job_salary_period.toLowerCase()}` : ""}`
        : null;
      // trust the posting's own country so off-country Google results are
      // filtered out by the run loop's country check
      const cCode = j.job_country ? j.job_country.toUpperCase() : countryCode;
      return {
        externalId: `js:${j.job_id ?? j.job_apply_link}`,
        title: j.job_title!,
        companyName: j.employer_name ?? "",
        location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ") || null,
        countryCode: cCode,
        remote: j.job_is_remote ? "remote" : isRemote(null, j.job_description),
        url: j.job_apply_link!,
        description: j.job_description ?? "",
        salaryRaw,
        postedAt: safeDate(j.job_posted_at_datetime_utc ?? j.job_posted_at_timestamp ?? null),
        source: "jsearch",
        market: marketFor(countryCode),
      };
    });
};

/* ---------- Jooble (all target countries incl. Ireland) ---------- */

type JoobleJob = {
  id?: string | number;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  link?: string;
  company?: string;
  updated?: string;
};

const jooble: ProviderAdapter = async ({ countryCode, roleQuery, keys, log }) => {
  const key = keys.jooble;
  const location = COUNTRY_NAME[countryCode];
  if (!key || !location) return [];
  // Jooble is a POST API: the key is the URL path, the query is the JSON body.
  const res = await politeFetch(`https://jooble.org/api/${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keywords: roleQuery, location }),
  });
  if (!res.ok) throw new Error(`jooble ${countryCode} -> ${res.status}`);
  const data = (await res.json()) as { jobs?: JoobleJob[] };
  const usable = (data.jobs ?? []).filter((j) => j.link && j.title);
  // Jooble has one global endpoint and no country field: when it runs out of
  // local matches it serves US jobs. Anchoring those to the searched country
  // is what put Illinois roles (and US pay) into the New Zealand results.
  const local = usable.filter((j) => !looksForeign(j.location ?? null, countryCode));
  const dropped = usable.length - local.length;
  if (dropped > 0) log(`jooble ${countryCode}: dropped ${dropped} postings located outside ${location}`);
  return local.map((j) => ({
    externalId: `jooble:${j.id ?? j.link}`,
    title: j.title!,
    companyName: j.company ?? "",
    location: j.location ?? null,
    countryCode,
    remote: isRemote(j.location, j.snippet),
    url: j.link!,
    description: stripTags(j.snippet ?? ""),
    salaryRaw: j.salary || null,
    postedAt: safeDate(j.updated),
    source: "jooble",
    market: marketFor(countryCode),
  }));
};

/* ---------- Reed (United Kingdom) ---------- */

const REED_COUNTRIES = new Set(["GB"]);

type ReedJob = {
  jobId?: number;
  employerName?: string;
  jobTitle?: string;
  locationName?: string;
  minimumSalary?: number;
  maximumSalary?: number;
  currency?: string;
  date?: string;
  jobUrl?: string;
  jobDescription?: string;
};

const reed: ProviderAdapter = async ({ countryCode, roleQuery, keys }) => {
  const key = keys.reed;
  if (!key || !REED_COUNTRIES.has(countryCode)) return [];
  const params = new URLSearchParams({ keywords: roleQuery, resultsToTake: "50" });
  // Reed uses HTTP Basic auth with the API key as the username, empty password.
  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  const res = await politeFetch(`https://www.reed.co.uk/api/1.0/search?${params.toString()}`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) throw new Error(`reed ${countryCode} -> ${res.status}`);
  const data = (await res.json()) as { results?: ReedJob[] };
  return (data.results ?? [])
    .filter((j) => j.jobUrl && j.jobTitle)
    .map((j) => {
      const parts: string[] = [];
      if (j.minimumSalary) parts.push(String(Math.round(j.minimumSalary)));
      if (j.maximumSalary && j.maximumSalary !== j.minimumSalary)
        parts.push(String(Math.round(j.maximumSalary)));
      const salaryRaw = parts.length ? `${parts.join(" - ")} ${j.currency ?? "GBP"}`.trim() : null;
      return {
        externalId: `reed:${j.jobId ?? j.jobUrl}`,
        title: j.jobTitle!,
        companyName: j.employerName ?? "",
        location: j.locationName ?? null,
        countryCode,
        remote: isRemote(j.locationName, j.jobDescription),
        url: j.jobUrl!,
        description: stripTags(j.jobDescription ?? ""),
        salaryRaw,
        postedAt: parseReedDate(j.date),
        source: "reed",
        market: marketFor(countryCode),
      };
    });
};

export const PROVIDER_ADAPTERS: Record<string, ProviderAdapter> = {
  careerjet,
  adzuna,
  jsearch,
  jooble,
  reed,
};
