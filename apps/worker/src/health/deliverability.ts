import dns from "node:dns/promises";
import type { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { getPlatformSmtp } from "../mail";

const { appMeta, users, notifications } = schema;

/**
 * Email deliverability monitor. On a schedule it checks the sending
 * domain's SPF, DKIM, DMARC, and MX records with plain node:dns lookups
 * and record parsing, stores the latest result for the admin card, and
 * alerts everyone the moment a check flips from healthy to failing. A
 * broken record is caught here instead of by a bounced application.
 */

const DOMAIN = process.env.DELIVERABILITY_DOMAIN ?? "tessconsole.cloud";
// Hostinger publishes DKIM under hostingermail-a/-b/-c (only the live one
// carries a key; the others are empty placeholders). Common providers'
// selectors follow as fallbacks.
const DKIM_SELECTORS = (process.env.DELIVERABILITY_DKIM_SELECTORS ?? "hostingermail-a,hostingermail-b,hostingermail-c,default,dkim,mail,google,s1,s2,selector1,selector2")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export type DeliverabilityResult = {
  domain: string;
  checkedAt: string;
  mx: { ok: boolean; detail: string };
  spf: { ok: boolean; detail: string };
  dmarc: { ok: boolean; detail: string };
  dkim: { ok: boolean; detail: string };
  healthy: boolean;
  /** a DNS lookup failed transiently, so this result is not trustworthy */
  inconclusive: boolean;
  failures: string[];
};

/** ENOTFOUND/ENODATA mean the record is genuinely absent; anything else
 *  (SERVFAIL, timeout, refused) is a transient lookup failure we must not
 *  read as "record missing". */
function isAbsent(code: string | undefined): boolean {
  return code === "ENOTFOUND" || code === "ENODATA";
}

type Lookup = { records: string[]; errored: boolean };

async function txt(name: string): Promise<Lookup> {
  try {
    const records = await dns.resolveTxt(name);
    return { records: records.map((chunks) => chunks.join("")), errored: false };
  } catch (err) {
    return { records: [], errored: !isAbsent((err as NodeJS.ErrnoException).code) };
  }
}

/** A DKIM selector record is usable only if it carries a non-empty p= key;
 *  `p=` with an empty value is a revoked key (RFC 6376) and must not count. */
function dkimUsable(rec: string): boolean {
  const m = /(?:^|;)\s*p=([^;]*)/i.exec(rec);
  if (!m) return false;
  return m[1].replace(/\s+/g, "").length > 0;
}

export async function checkDeliverability(domain = DOMAIN): Promise<DeliverabilityResult> {
  let inconclusive = false;

  let mxRecords: { exchange: string; priority: number }[] = [];
  try {
    mxRecords = await dns.resolveMx(domain);
  } catch (err) {
    if (!isAbsent((err as NodeJS.ErrnoException).code)) inconclusive = true;
  }
  const mx = {
    ok: mxRecords.length > 0,
    detail: mxRecords.length > 0 ? mxRecords.map((m) => m.exchange).slice(0, 3).join(", ") : "no MX records",
  };

  const rootTxt = await txt(domain);
  if (rootTxt.errored) inconclusive = true;
  const spfRecords = rootTxt.records.filter((r) => r.toLowerCase().startsWith("v=spf1"));
  const spf =
    spfRecords.length === 1
      ? { ok: true, detail: spfRecords[0].slice(0, 120) }
      : spfRecords.length === 0
        ? { ok: false, detail: "no v=spf1 TXT record" }
        : { ok: false, detail: `${spfRecords.length} v=spf1 records (RFC 7208 permerror, must be one)` };

  const dmarcTxt = await txt(`_dmarc.${domain}`);
  if (dmarcTxt.errored) inconclusive = true;
  const dmarcRecord = dmarcTxt.records.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  const dmarc = { ok: Boolean(dmarcRecord), detail: dmarcRecord ? dmarcRecord.slice(0, 120) : "no v=DMARC1 TXT record at _dmarc" };

  // check every selector; lock onto the first with a live key, so a stale
  // revoked selector listed first does not mask a working one
  let dkimSelector: string | null = null;
  for (const sel of DKIM_SELECTORS) {
    const recs = await txt(`${sel}._domainkey.${domain}`);
    if (recs.errored) inconclusive = true;
    if (recs.records.some((r) => (/v=dkim1/i.test(r) || /(?:^|;)\s*p=/.test(r)) && dkimUsable(r))) {
      dkimSelector = sel;
      break;
    }
  }
  const dkim = {
    ok: Boolean(dkimSelector),
    detail: dkimSelector ? `live key at ${dkimSelector}._domainkey` : `no usable DKIM key at any of: ${DKIM_SELECTORS.slice(0, 6).join(", ")}`,
  };

  const failures: string[] = [];
  if (!mx.ok) failures.push("MX");
  if (!spf.ok) failures.push("SPF");
  if (!dmarc.ok) failures.push("DMARC");
  if (!dkim.ok) failures.push("DKIM");

  return {
    domain,
    checkedAt: new Date().toISOString(),
    mx,
    spf,
    dmarc,
    dkim,
    healthy: failures.length === 0,
    inconclusive,
    failures,
  };
}

export async function monitorDeliverability(db: Db, redis: Redis, log: Logger): Promise<string> {
  const result = await checkDeliverability();

  const prevRow = await db.select().from(appMeta).where(eq(appMeta.key, "health.deliverability")).limit(1);
  const prev = prevRow[0]?.value as DeliverabilityResult | undefined;

  await db
    .insert(appMeta)
    .values({ key: "health.deliverability", value: result })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: result, updatedAt: new Date() } });

  // alert only on a transition into a genuine failing state: never on a
  // transient DNS lookup failure, and only when the previous check was
  // healthy, so a persistent problem does not spam every run
  const wasHealthy = prev ? prev.healthy : true;
  if (!result.healthy && !result.inconclusive && wasHealthy) {
    const title = `Email deliverability alert: ${result.failures.join(", ")} failing on ${result.domain}`;
    const body = `SPF ${result.spf.ok ? "ok" : "FAIL"}, DKIM ${result.dkim.ok ? "ok" : "FAIL"}, DMARC ${result.dmarc.ok ? "ok" : "FAIL"}, MX ${result.mx.ok ? "ok" : "FAIL"}. Outbound email may be rejected or spam-filtered until fixed.`;
    const smtp = await getPlatformSmtp(db);
    const everyone = await db.select({ id: users.id, email: users.email }).from(users);
    for (const u of everyone) {
      const [n] = await db
        .insert(notifications)
        .values({ userId: u.id, type: "health.deliverability", title, body, href: "/operations" })
        .returning();
      await redis
        .publish(`notify:${u.id}`, JSON.stringify({ unread: 1, notification: { id: n.id, title, type: "health.deliverability" } }))
        .catch(() => {});
      if (smtp) {
        await smtp.transport.sendMail({ from: smtp.from, to: u.email, subject: title, text: body }).catch(() => {});
      }
    }
    log.warn({ failures: result.failures, domain: result.domain }, "deliverability alert raised");
    return `deliverability failing: ${result.failures.join(", ")}, alerted ${everyone.length}`;
  }

  if (result.inconclusive) return `deliverability check inconclusive (transient DNS failure) on ${result.domain}`;
  return result.healthy ? `deliverability healthy on ${result.domain}` : `deliverability still failing: ${result.failures.join(", ")}`;
}
