import { load } from "cheerio";
import { politeFetch } from "../fetch";
import { inferCountry, isRemote, marketFor } from "../countries";
import type { FetchContext, RawPosting } from "../types";

/**
 * Direct public JSON feed adapters for the seven ATS platforms. These
 * are the preferred source everywhere they exist. Each takes a board
 * token from the source config and returns normalized postings.
 */

function stripHtml(html: string): string {
  if (!html) return "";
  if (!/[<>]/.test(html)) return html;
  return load(html).text().replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Greenhouse returns HTML that is itself entity-encoded; decode then strip. */
function greenhouseContent(raw?: string): string {
  if (!raw) return "";
  const decoded = load(`<x>${raw}</x>`)("x").text();
  return stripHtml(decoded);
}

function mk(
  source: string,
  p: Partial<RawPosting> & { externalId: string; title: string; companyName: string; url: string; description: string },
): RawPosting {
  const country = p.countryCode ?? inferCountry(p.location);
  return {
    externalId: p.externalId,
    title: p.title,
    companyName: p.companyName,
    location: p.location ?? null,
    countryCode: country,
    remote: p.remote ?? isRemote(p.location, p.description),
    url: p.url,
    description: p.description,
    salaryRaw: p.salaryRaw ?? null,
    postedAt: p.postedAt ?? null,
    source,
    market: p.market ?? marketFor(country),
  };
}

type Cfg = { board?: string; company?: string; account?: string; companyName?: string; apiKey?: string };

export async function greenhouse(cfg: Cfg, ctx: FetchContext): Promise<RawPosting[]> {
  const board = cfg.board!;
  const res = await politeFetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`, {
    proxyUrl: ctx.proxyUrl,
  });
  if (!res.ok) throw new Error(`greenhouse ${board} -> ${res.status}`);
  const data = (await res.json()) as {
    jobs: { id: number; title: string; location?: { name: string }; absolute_url: string; content?: string; updated_at?: string }[];
  };
  const company = cfg.companyName ?? board;
  return (data.jobs ?? []).map((j) =>
    mk("greenhouse", {
      externalId: `gh:${board}:${j.id}`,
      title: j.title,
      companyName: company,
      location: j.location?.name ?? null,
      url: j.absolute_url,
      description: greenhouseContent(j.content),
      postedAt: j.updated_at ? new Date(j.updated_at) : null,
    }),
  );
}

export async function lever(cfg: Cfg, ctx: FetchContext): Promise<RawPosting[]> {
  const company = cfg.company!;
  const res = await politeFetch(`https://api.lever.co/v0/postings/${company}?mode=json`, { proxyUrl: ctx.proxyUrl });
  if (!res.ok) throw new Error(`lever ${company} -> ${res.status}`);
  const data = (await res.json()) as {
    id: string;
    text: string;
    categories?: { location?: string; commitment?: string; team?: string };
    hostedUrl: string;
    descriptionPlain?: string;
    createdAt?: number;
  }[];
  return (Array.isArray(data) ? data : []).map((j) =>
    mk("lever", {
      externalId: `lever:${company}:${j.id}`,
      title: j.text,
      companyName: cfg.companyName ?? company,
      location: j.categories?.location ?? null,
      url: j.hostedUrl,
      description: j.descriptionPlain ?? "",
      postedAt: j.createdAt ? new Date(j.createdAt) : null,
    }),
  );
}

export async function ashby(cfg: Cfg, ctx: FetchContext): Promise<RawPosting[]> {
  const board = cfg.board!;
  const res = await politeFetch(
    `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`,
    { proxyUrl: ctx.proxyUrl },
  );
  if (!res.ok) throw new Error(`ashby ${board} -> ${res.status}`);
  const data = (await res.json()) as {
    jobs: {
      id: string;
      title: string;
      location?: string;
      employmentType?: string;
      jobUrl: string;
      descriptionPlain?: string;
      publishedAt?: string;
      compensation?: { compensationTierSummary?: string };
      isRemote?: boolean;
    }[];
  };
  return (data.jobs ?? []).map((j) =>
    mk("ashby", {
      externalId: `ashby:${board}:${j.id}`,
      title: j.title,
      companyName: cfg.companyName ?? board,
      location: j.location ?? null,
      remote: j.isRemote ? "remote" : undefined,
      url: j.jobUrl,
      description: j.descriptionPlain ?? "",
      salaryRaw: j.compensation?.compensationTierSummary ?? null,
      postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
    }),
  );
}

export async function workable(cfg: Cfg, ctx: FetchContext): Promise<RawPosting[]> {
  const account = cfg.account!;
  const res = await politeFetch(
    `https://apply.workable.com/api/v1/widget/accounts/${account}?details=true`,
    { proxyUrl: ctx.proxyUrl },
  );
  if (!res.ok) throw new Error(`workable ${account} -> ${res.status}`);
  const data = (await res.json()) as {
    name?: string;
    jobs: { id?: string; shortcode: string; title: string; location?: { city?: string; country?: string }; url: string; description?: string; created_at?: string }[];
  };
  return (data.jobs ?? []).map((j) =>
    mk("workable", {
      externalId: `wk:${account}:${j.shortcode}`,
      title: j.title,
      companyName: cfg.companyName ?? data.name ?? account,
      location: [j.location?.city, j.location?.country].filter(Boolean).join(", ") || null,
      url: j.url,
      description: stripHtml(j.description ?? ""),
      postedAt: j.created_at ? new Date(j.created_at) : null,
    }),
  );
}

export async function smartrecruiters(cfg: Cfg, ctx: FetchContext): Promise<RawPosting[]> {
  const company = cfg.company!;
  const res = await politeFetch(
    `https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100`,
    { proxyUrl: ctx.proxyUrl },
  );
  if (!res.ok) throw new Error(`smartrecruiters ${company} -> ${res.status}`);
  const data = (await res.json()) as {
    content: { id: string; name: string; location?: { city?: string; country?: string }; ref?: string; releasedDate?: string; company?: { name?: string } }[];
  };
  return (data.content ?? []).map((j) =>
    mk("smartrecruiters", {
      externalId: `sr:${company}:${j.id}`,
      title: j.name,
      companyName: cfg.companyName ?? j.company?.name ?? company,
      location: [j.location?.city, j.location?.country].filter(Boolean).join(", ") || null,
      url: j.ref ?? `https://jobs.smartrecruiters.com/${company}/${j.id}`,
      description: "",
      postedAt: j.releasedDate ? new Date(j.releasedDate) : null,
    }),
  );
}

export async function recruitee(cfg: Cfg, ctx: FetchContext): Promise<RawPosting[]> {
  const company = cfg.company!;
  const res = await politeFetch(`https://${company}.recruitee.com/api/offers/`, { proxyUrl: ctx.proxyUrl });
  if (!res.ok) throw new Error(`recruitee ${company} -> ${res.status}`);
  const data = (await res.json()) as {
    offers: { id: number; title: string; location?: string; city?: string; country_code?: string; careers_url: string; description?: string; published_at?: string }[];
  };
  return (data.offers ?? []).map((j) =>
    mk("recruitee", {
      externalId: `rc:${company}:${j.id}`,
      title: j.title,
      companyName: cfg.companyName ?? company,
      location: j.location ?? j.city ?? null,
      countryCode: j.country_code ? j.country_code.toUpperCase() : undefined,
      url: j.careers_url,
      description: stripHtml(j.description ?? ""),
      postedAt: j.published_at ? new Date(j.published_at) : null,
    }),
  );
}

export async function teamtailor(cfg: Cfg, ctx: FetchContext): Promise<RawPosting[]> {
  // Teamtailor's JSON:API needs an API token. When configured, use it;
  // otherwise the source should be an rss type against /jobs.rss.
  if (!cfg.apiKey) return [];
  const company = cfg.company!;
  const res = await politeFetch(
    `https://api.teamtailor.com/v1/jobs?include=department&page[size]=100`,
    {
      proxyUrl: ctx.proxyUrl,
      headers: {
        Authorization: `Token token=${cfg.apiKey}`,
        "X-Api-Version": "20210218",
        Accept: "application/vnd.api+json",
      },
    },
  );
  if (!res.ok) throw new Error(`teamtailor ${company} -> ${res.status}`);
  const data = (await res.json()) as {
    data: { id: string; attributes: { title: string; "pitch"?: string; body?: string; "created-at"?: string }; links?: { "careersite-job-url"?: string } }[];
  };
  return (data.data ?? []).map((j) =>
    mk("teamtailor", {
      externalId: `tt:${company}:${j.id}`,
      title: j.attributes.title,
      companyName: cfg.companyName ?? company,
      location: null,
      url: j.links?.["careersite-job-url"] ?? `https://${company}.teamtailor.com/jobs/${j.id}`,
      description: stripHtml(j.attributes.body ?? j.attributes.pitch ?? ""),
      postedAt: j.attributes["created-at"] ? new Date(j.attributes["created-at"]) : null,
    }),
  );
}

export const ATS_ADAPTERS: Record<string, (cfg: Cfg, ctx: FetchContext) => Promise<RawPosting[]>> = {
  greenhouse,
  lever,
  ashby,
  workable,
  smartrecruiters,
  recruitee,
  teamtailor,
};
