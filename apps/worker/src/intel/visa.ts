import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { getPlatformSmtp } from "../mail";
import { fetchTextCapped, readableText } from "./fetch";

const { monitoredPages, users, notifications } = schema;

/**
 * Visa and sponsor-register monitoring. On a schedule, Tess fetches each
 * enabled official page, reduces it to readable text, and hashes it. The
 * first fetch stores a baseline silently. Any later fetch whose hash
 * differs is a change: the snapshot and hash update, and every user is
 * alerted with a notification and, if platform SMTP is set, an email.
 * These are country-level rules that affect everyone, so the alert is
 * global rather than per-user.
 */

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A rough, human-readable sense of how much changed. */
function changeSize(oldText: string | null, newText: string): string {
  if (!oldText) return "new baseline";
  const delta = Math.abs(newText.length - oldText.length);
  return `${delta} characters changed in length`;
}

async function alertEveryone(
  db: Db,
  redis: Redis,
  page: { label: string; countryCode: string | null; url: string },
  detail: string,
) {
  const everyone = await db.select({ id: users.id, email: users.email }).from(users);
  const title = `Immigration update: ${page.label}${page.countryCode ? ` (${page.countryCode})` : ""}`;
  const body = `The official page changed. ${detail}. Review it before relying on prior guidance.`;
  const smtp = await getPlatformSmtp(db);
  for (const u of everyone) {
    const [n] = await db
      .insert(notifications)
      .values({ userId: u.id, type: "visa.change", title, body, href: page.url })
      .returning();
    await redis
      .publish(`notify:${u.id}`, JSON.stringify({ unread: 1, notification: { id: n.id, title, type: "visa.change" } }))
      .catch(() => {});
    if (smtp) {
      await smtp.transport
        .sendMail({ from: smtp.from, to: u.email, subject: title, text: `${body}\n\n${page.url}` })
        .catch(() => {});
    }
  }
  return everyone.length;
}

export async function monitorVisaPages(db: Db, redis: Redis, log: Logger): Promise<string> {
  const pages = await db.select().from(monitoredPages).where(eq(monitoredPages.enabled, true));
  if (pages.length === 0) return "no monitored pages";

  let checked = 0;
  let changed = 0;
  for (const page of pages) {
    const html = await fetchTextCapped(page.url);
    checked += 1;
    if (!html) {
      await db
        .update(monitoredPages)
        .set({ lastCheckedAt: new Date() })
        .where(eq(monitoredPages.id, page.id));
      log.warn({ url: page.url }, "monitored page fetch failed");
      continue;
    }
    const text = readableText(html).slice(0, 200000);
    const hash = hashText(text);

    if (!page.contentHash) {
      // first sight: store baseline silently
      await db
        .update(monitoredPages)
        .set({ contentHash: hash, snapshot: text.slice(0, 20000), lastCheckedAt: new Date() })
        .where(eq(monitoredPages.id, page.id));
      continue;
    }

    if (hash !== page.contentHash) {
      const detail = changeSize(page.snapshot, text);
      await db
        .update(monitoredPages)
        .set({
          contentHash: hash,
          snapshot: text.slice(0, 20000),
          lastCheckedAt: new Date(),
          lastChangedAt: new Date(),
        })
        .where(eq(monitoredPages.id, page.id));
      const recipients = await alertEveryone(db, redis, page, detail);
      changed += 1;
      log.info({ url: page.url, recipients }, "monitored page changed, alerted");
    } else {
      await db
        .update(monitoredPages)
        .set({ lastCheckedAt: new Date() })
        .where(eq(monitoredPages.id, page.id));
    }
  }

  return changed > 0
    ? `${checked} pages checked, ${changed} changed and alerted`
    : `${checked} pages checked, no changes`;
}
