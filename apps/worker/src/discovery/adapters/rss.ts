import Parser from "rss-parser";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { ProxyAgent } from "undici";
import { inferCountry, isRemote, marketFor } from "../countries";
import type { FetchContext, RawPosting } from "../types";

/**
 * RSS/Atom job feeds via rss-parser. Many boards (IrishJobs, Jobs.ie,
 * oil and gas boards) publish feeds. The proxy toggle is honored by
 * fetching through undici first when enabled, then handing the text to
 * the parser.
 */
type Cfg = { url?: string; companyName?: string };

export async function rss(cfg: Cfg, ctx: FetchContext): Promise<RawPosting[]> {
  const url = cfg.url!;
  const parser = new Parser({ timeout: 20000 });
  let feed;
  if (ctx.proxyUrl) {
    const dispatcher = new ProxyAgent(ctx.proxyUrl);
    try {
      const { fetch: undiciFetch } = await import("undici");
      const res = await undiciFetch(url, { dispatcher, signal: AbortSignal.timeout(20000) });
      feed = await parser.parseString(await res.text());
    } finally {
      await dispatcher.close().catch(() => {});
    }
  } else {
    feed = await parser.parseURL(url);
  }

  return (feed.items ?? []).map((item) => {
    const desc = item.contentSnippet ?? (item.content ? load(item.content).text() : "") ?? "";
    const location = extractLocation(item.title ?? "", desc);
    const country = inferCountry(`${item.title ?? ""} ${location} ${desc}`);
    const link = item.link ?? "";
    const externalId = `rss:${createHash("sha1").update((item.guid ?? link ?? item.title ?? "").toString()).digest("hex").slice(0, 16)}`;
    return {
      externalId,
      title: (item.title ?? "Untitled").slice(0, 200),
      companyName: cfg.companyName ?? extractCompany(item) ?? "Unknown",
      location,
      countryCode: country,
      remote: isRemote(location, desc),
      url: link,
      description: desc.slice(0, 20000),
      salaryRaw: extractSalary(`${item.title ?? ""} ${desc}`),
      postedAt: item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : null,
      source: "rss",
      market: marketFor(country),
    } satisfies RawPosting;
  });
}

function extractCompany(item: Record<string, unknown>): string | null {
  const c = (item["company"] ?? item["dc:creator"] ?? item["author"]) as string | undefined;
  return c ? String(c).slice(0, 160) : null;
}

function extractLocation(title: string, desc: string): string | null {
  const m = /(?:in|based in|location:?)\s+([A-Z][a-zA-Z .'-]{2,40})/i.exec(`${title}. ${desc}`);
  return m ? m[1].trim() : null;
}

const SALARY_RE =
  /(?:[€£$]|EUR|GBP|USD|NZ\$|AU\$|CAD|NOK|AED|QAR|SAR)\s?[\d.,]+\s?(?:k|K)?(?:\s?(?:-|to|–)\s?(?:[€£$])?[\d.,]+\s?k?)?(?:\s?(?:per|\/)\s?(?:year|month|day|hour|annum|yr|mo))?/;

function extractSalary(text: string): string | null {
  return SALARY_RE.exec(text)?.[0]?.trim() ?? null;
}
