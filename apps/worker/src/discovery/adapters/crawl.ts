import { createHash } from "node:crypto";
import { CheerioCrawler, PlaywrightCrawler, Configuration, ProxyConfiguration } from "crawlee";
import { inferCountry, isRemote, marketFor } from "../countries";
import type { FetchContext, RawPosting } from "../types";

/**
 * Crawlee crawlers for custom career pages. CheerioCrawler for static
 * HTML, PlaywrightCrawler for JavaScript-heavy pages, both with the
 * per-source proxy toggle and polite rate limiting. Extraction is by
 * CSS selectors from the source config, with JSON-LD JobPosting as a
 * fallback. LLM-assisted extraction for fully unstructured pages is a
 * later enhancement seam.
 *
 * Crawlee's own storage is disabled (purgeOnStart, in-memory) so runs
 * never touch disk state across the shared box.
 */

type Cfg = {
  url?: string;
  companyName?: string;
  engine?: "cheerio" | "playwright";
  itemSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
  locationSelector?: string;
};

Configuration.getGlobalConfig().set("persistStorage", false);

export async function crawl(cfg: Cfg, ctx: FetchContext): Promise<RawPosting[]> {
  const url = cfg.url!;
  const results: RawPosting[] = [];
  const company = cfg.companyName ?? new URL(url).hostname.replace(/^www\./, "");
  const proxyConfiguration = ctx.proxyUrl
    ? new ProxyConfiguration({ proxyUrls: [ctx.proxyUrl] })
    : undefined;

  const push = (title: string, link: string, location: string | null, description: string) => {
    const country = inferCountry(`${location ?? ""} ${title}`);
    results.push({
      externalId: `crawl:${createHash("sha1").update(link || title).digest("hex").slice(0, 16)}`,
      title: title.slice(0, 200),
      companyName: company,
      location,
      countryCode: country,
      remote: isRemote(location, description),
      url: link,
      description: description.slice(0, 20000),
      salaryRaw: null,
      postedAt: null,
      source: "crawl",
      market: marketFor(country),
    });
  };

  const common = {
    maxRequestsPerCrawl: 5,
    maxConcurrency: 1,
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 30,
    proxyConfiguration,
  };

  if (cfg.engine === "playwright") {
    const crawler = new PlaywrightCrawler({
      ...common,
      requestHandler: async ({ page }) => {
        const items = cfg.itemSelector ? await page.$$(cfg.itemSelector) : [];
        for (const item of items.slice(0, 50)) {
          const title = cfg.titleSelector
            ? (await item.$eval(cfg.titleSelector, (el) => el.textContent ?? "").catch(() => "")) || ""
            : (await item.textContent()) ?? "";
          const link = cfg.linkSelector
            ? (await item.$eval(cfg.linkSelector, (el) => (el as HTMLAnchorElement).href).catch(() => "")) || url
            : url;
          const location = cfg.locationSelector
            ? (await item.$eval(cfg.locationSelector, (el) => el.textContent ?? "").catch(() => null)) || null
            : null;
          if (title.trim()) push(title.trim(), link, location, "");
        }
      },
    });
    await crawler.run([url]);
    return results;
  }

  const crawler = new CheerioCrawler({
    ...common,
    requestHandler: async ({ $ }) => {
      // JSON-LD JobPosting first
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const parsed = JSON.parse($(el).text());
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          for (const node of arr) {
            if (node["@type"] === "JobPosting" && node.title) {
              push(String(node.title), node.url ?? url, node.jobLocation?.address?.addressLocality ?? null, String(node.description ?? ""));
            }
          }
        } catch {
          // not valid JSON-LD, ignore
        }
      });
      if (results.length === 0 && cfg.itemSelector) {
        $(cfg.itemSelector).each((_, el) => {
          const title = cfg.titleSelector ? $(el).find(cfg.titleSelector).first().text().trim() : $(el).text().trim();
          const href = cfg.linkSelector ? $(el).find(cfg.linkSelector).first().attr("href") : undefined;
          const location = cfg.locationSelector ? $(el).find(cfg.locationSelector).first().text().trim() : null;
          if (title) push(title, href ? new URL(href, url).toString() : url, location || null, "");
        });
      }
    },
  });
  await crawler.run([url]);
  return results;
}
