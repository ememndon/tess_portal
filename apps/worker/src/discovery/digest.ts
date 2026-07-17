import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { getPlatformSmtp } from "../mail";
import { annualEur, loadRates } from "./normalize";

/**
 * Daily digest: the top scored, freshest-first new matches for a user,
 * emailed and dropped into notifications. Salaries display normalized
 * to an annual EUR-equivalent so markets compare. Matches are limited to
 * the user's target countries and pass the same sponsorship gate as
 * Discover, so the email never surfaces off-target (e.g. US) or
 * register-country-unverified roles.
 */
export async function sendDigestForUser(db: Db, redis: import("ioredis").Redis, log: Logger, userId: string): Promise<string> {
  const rates = await loadRates(db);
  const since = new Date(Date.now() - 26 * 3600 * 1000);

  const [settings] = await db
    .select({
      targetCountries: schema.userSettings.targetCountries,
      requireSponsorship: schema.userSettings.requireSponsorship,
    })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);
  const targetCodes = ((settings?.targetCountries as { code: string | null }[]) ?? [])
    .map((c) => c.code)
    .filter((c): c is string => Boolean(c));
  const requireSponsorship = settings?.requireSponsorship ?? true;

  const conds = [
    eq(schema.jobs.userId, userId),
    eq(schema.jobs.saved, false),
    sql`${schema.jobs.dismissedAt} is null`,
    gt(schema.jobs.createdAt, since),
    // never email postings older than a month
    sql`(${schema.jobs.postedAt} is null or ${schema.jobs.postedAt} >= now() - interval '30 days')`,
  ];
  // only email jobs actually located in a chosen country (kills US / unparsed-location leaks)
  if (targetCodes.length) conds.push(inArray(schema.jobs.countryCode, targetCodes));
  // same smart-strict gate as Discover: hide register-country roles with no sponsorship signal
  if (requireSponsorship) {
    conds.push(
      // NZ excluded on purpose (no bulk register — shown like AU, not gated)
      sql`NOT (${schema.jobs.countryCode} IN ('GB','NL','CA','IE') AND ${schema.jobs.sponsorship} = 'unknown')`,
    );
  }

  const matches = await db
    .select()
    .from(schema.jobs)
    .where(and(...conds))
    .orderBy(desc(schema.jobs.matchScore), desc(schema.jobs.postedAt))
    .limit(10);

  if (matches.length === 0) return "no new matches to digest";

  const [user] = await db
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return "user gone";

  const lines = matches.map((m) => {
    const eur = annualEur(m, rates);
    const salary = eur ? `~€${Math.round(eur / 1000)}k/yr` : m.salaryRaw ?? "salary not listed";
    const spons =
      m.sponsorship === "yes" ? "sponsor confirmed" : m.sponsorship === "inferred" ? "sponsorship inferred" : "";
    return `${m.matchScore ?? "--"}  ${m.title} — ${m.companyName}, ${m.location ?? m.countryCode ?? ""}  ${salary}${spons ? "  [" + spons + "]" : ""}`;
  });

  const body = [
    `Good morning ${user.name || ""}`.trim() + ",",
    "",
    `${matches.length} new match${matches.length === 1 ? "" : "es"} overnight, best first:`,
    "",
    ...lines,
    "",
    "Open Discover to prepare any of these: https://career.tessconsole.cloud/discover",
    "",
    "Tess",
  ].join("\n");

  const smtp = await getPlatformSmtp(db);
  let emailed = false;
  if (smtp) {
    try {
      await smtp.transport.sendMail({
        from: smtp.from,
        to: user.email,
        subject: `${matches.length} new job match${matches.length === 1 ? "" : "es"} for you`,
        text: body,
      });
      emailed = true;
    } catch (err) {
      log.error({ err: (err as Error).message }, "digest email failed");
    }
  }

  const [n] = await db
    .insert(schema.notifications)
    .values({
      userId,
      type: "digest",
      title: `${matches.length} new job match${matches.length === 1 ? "" : "es"} overnight`,
      body: `Top match: ${matches[0].title} at ${matches[0].companyName}, scored ${matches[0].matchScore}.`,
      href: "/discover",
    })
    .returning();
  await redis
    .publish(`notify:${userId}`, JSON.stringify({ unread: 1, notification: { id: n.id, title: n.title, type: "digest" } }))
    .catch(() => {});

  return `digest: ${matches.length} matches${emailed ? " emailed" : " (email skipped)"}`;
}
