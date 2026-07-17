import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { fetchTextCapped, readableText } from "./fetch";

const { companyWatchlist, companies, signals, notifications } = schema;

/**
 * Hiring-signal detection from scheduled news and funding fetches. For
 * each watched company with a website, Tess reads its news, blog, and
 * press pages, hashes the readable text, and compares against the hash
 * stored on the company. A change becomes a signal and a notification,
 * so the user hears about movement at a company they care about. The
 * per-posting signals come from the watchlist monitor; this covers the
 * softer news and funding surface. Hashes live under brief.newsHash so
 * the research brief and ATS detection are left untouched.
 */

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const NEWS_PATHS = ["/news", "/blog", "/press", "/newsroom", "/company/news"];

export async function detectCompanySignals(db: Db, redis: Redis, log: Logger): Promise<string> {
  const watched = await db
    .select({
      userId: companyWatchlist.userId,
      companyId: companies.id,
      name: companies.name,
      website: companies.website,
      brief: companies.brief,
    })
    .from(companyWatchlist)
    .innerJoin(companies, eq(companies.id, companyWatchlist.companyId));

  if (watched.length === 0) return "no watched companies";

  let detected = 0;
  for (const w of watched) {
    if (!w.website) continue;
    let base: URL;
    try {
      base = new URL(w.website);
    } catch {
      continue;
    }

    const brief = (w.brief as Record<string, unknown> | null) ?? {};
    const prevHash = typeof brief.newsHash === "string" ? brief.newsHash : null;
    const prevUrl = typeof brief.newsUrl === "string" ? brief.newsUrl : null;

    // prefer the page that produced the stored baseline so a different
    // path answering between runs is not misread as a change; otherwise
    // scan for the first news-like page that answers
    const candidates = prevUrl ? [prevUrl, ...NEWS_PATHS.map((p) => new URL(p, base).toString())] : NEWS_PATHS.map((p) => new URL(p, base).toString());
    let text: string | null = null;
    let fromUrl: string | null = null;
    for (const url of [...new Set(candidates)]) {
      const html = await fetchTextCapped(url);
      if (html) {
        const readable = readableText(html);
        if (readable.length > 200) {
          text = readable.slice(0, 120000);
          fromUrl = url;
          break;
        }
      }
    }
    if (!text || !fromUrl) continue;

    const hash = hashText(text);

    // no baseline, or the winning page changed: (re)establish the baseline
    // silently, binding the hash to the exact URL it came from
    if (!prevHash || fromUrl !== prevUrl) {
      await db
        .update(companies)
        .set({ brief: { ...brief, newsHash: hash, newsUrl: fromUrl }, updatedAt: new Date() })
        .where(eq(companies.id, w.companyId));
      continue;
    }

    if (hash !== prevHash) {
      await db
        .update(companies)
        .set({ brief: { ...brief, newsHash: hash, newsUrl: fromUrl }, updatedAt: new Date() })
        .where(eq(companies.id, w.companyId));
      await db.insert(signals).values({
        userId: w.userId,
        companyId: w.companyId,
        type: "news_update",
        payload: { url: fromUrl, note: "News or press page changed since last check" },
      });
      const title = `${w.name} posted news`;
      const [n] = await db
        .insert(notifications)
        .values({
          userId: w.userId,
          type: "signal.news",
          title,
          body: "Their news or press page changed. Could be funding, a launch, or hiring movement.",
          href: "/companies",
        })
        .returning();
      await redis
        .publish(`notify:${w.userId}`, JSON.stringify({ unread: 1, notification: { id: n.id, title, type: "signal.news" } }))
        .catch(() => {});
      detected += 1;
    }
  }

  return detected > 0 ? `${detected} company signal${detected === 1 ? "" : "s"} detected` : "no new company signals";
}
