import { eq, sql } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { getDb } from "../server/db";
import { getRedis, getLogger } from "../server/health";
import { createNotification } from "../server/notify";
import { sendPlatformMail } from "../server/mailer";
import { computeCostUsd, providerInfo } from "./catalog";

const { usageEvents, capConfig, providers: providersTable, appMeta, users } = schema;

/**
 * Live metering: per-provider daily counters in Redis for free-tier
 * limits, a running monthly spend counter, the $40 cap with the 80%
 * alert, and degrade-to-free at 100%. Every AI call writes a
 * usage_event; the counters make the gauges live.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function recordUsage(event: {
  userId: string | null;
  feature: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}) {
  const cost = computeCostUsd(event.provider, event.model, event.tokensIn, event.tokensOut);
  const db = getDb();
  await db.insert(usageEvents).values({
    userId: event.userId,
    feature: event.feature,
    provider: event.provider,
    model: event.model,
    tokensIn: event.tokensIn,
    tokensOut: event.tokensOut,
    costUsd: cost.toFixed(6),
  });
  const redis = getRedis();
  const day = today();
  try {
    await redis
      .multi()
      .incrby(`meter:${event.provider}:${day}:requests`, 1)
      .incrby(`meter:${event.provider}:${day}:tokens`, event.tokensIn + event.tokensOut)
      .expire(`meter:${event.provider}:${day}:requests`, 172800)
      .expire(`meter:${event.provider}:${day}:tokens`, 172800)
      .incrbyfloat(`spend:${monthKey()}`, cost)
      .exec();
  } catch (err) {
    getLogger().error({ err: (err as Error).message }, "meter update failed");
  }
  if (cost > 0) await checkCapAlert().catch(() => {});
  return cost;
}

export async function providerDailyUsage(provider: string) {
  const day = today();
  try {
    const redis = getRedis();
    const [requests, tokens] = await redis.mget(
      `meter:${provider}:${day}:requests`,
      `meter:${provider}:${day}:tokens`,
    );
    return { requests: Number(requests ?? 0), tokens: Number(tokens ?? 0) };
  } catch (err) {
    // Redis is a soft dependency for free-tier accounting. If it is
    // unreachable, assume the allowance has room so AI features keep working
    // instead of returning a 500 on every request. The daily counters resume
    // when Redis recovers.
    getLogger().error(
      { err: (err as Error).message, provider },
      "provider usage read failed; assuming free-tier has room",
    );
    return { requests: 0, tokens: 0 };
  }
}

export async function providerLimits(provider: string) {
  const rows = await getDb()
    .select({ dailyLimits: providersTable.dailyLimits, enabled: providersTable.enabled })
    .from(providersTable)
    .where(eq(providersTable.id, provider))
    .limit(1);
  return {
    limits: (rows[0]?.dailyLimits ?? providerInfo(provider)?.defaultDailyLimits ?? null) as
      | { requests: number; tokens: number }
      | null,
    enabled: rows[0]?.enabled ?? true,
  };
}

/** True while today's free-tier allowance for the provider has room. */
export async function freeTierHasRoom(provider: string): Promise<boolean> {
  const { limits } = await providerLimits(provider);
  if (!limits) return true;
  const usage = await providerDailyUsage(provider);
  return usage.requests < limits.requests && usage.tokens < limits.tokens;
}

export async function getCap() {
  const rows = await getDb().select().from(capConfig).where(eq(capConfig.id, 1)).limit(1);
  return rows[0] ?? { id: 1, monthlyCapUsd: "40", alertAtPct: 80, updatedAt: new Date() };
}

export async function monthlySpend(): Promise<number> {
  const redis = getRedis();
  const cached = await redis.get(`spend:${monthKey()}`).catch(() => null);
  if (cached !== null) return Number(cached);
  return recomputeMonthlySpend();
}

/** Recomputes the month's spend from usage_events, the source of truth. */
export async function recomputeMonthlySpend(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(sql`to_char(${usageEvents.createdAt}, 'YYYY-MM') = ${monthKey()}`);
  const total = Number(row.total);
  await getRedis()
    .set(`spend:${monthKey()}`, String(total), "EX", 3600)
    .catch(() => {});
  return total;
}

/** True once the monthly cap is consumed: paid providers lock, free chain stays. */
export async function capExceeded(): Promise<boolean> {
  const cap = await getCap();
  return (await monthlySpend()) >= Number(cap.monthlyCapUsd);
}

/** Raises the one-per-month 80% alert to every admin, email and in-app. */
export async function checkCapAlert() {
  const cap = await getCap();
  const spend = await monthlySpend();
  const capUsd = Number(cap.monthlyCapUsd);
  if (capUsd <= 0 || spend < (capUsd * cap.alertAtPct) / 100) return;

  const db = getDb();
  const marker = await db.select().from(appMeta).where(eq(appMeta.key, "cap.alerted")).limit(1);
  if ((marker[0]?.value as { month?: string } | null)?.month === monthKey()) return;
  await db
    .insert(appMeta)
    .values({ key: "cap.alerted", value: { month: monthKey() } })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: { month: monthKey() }, updatedAt: new Date() } });

  const everyone = await db.select({ id: users.id, email: users.email }).from(users);
  const title = `AI budget alert: ${Math.round((spend / capUsd) * 100)}% of the $${capUsd} cap is used`;
  const body = `$${spend.toFixed(2)} of $${capUsd} is spent this month. At 100% the platform degrades to free models only.`;
  for (const u of everyone) {
    await createNotification(u.id, { type: "cap.alert", title, body, href: "/admin" }).catch(() => {});
    await sendPlatformMail({ to: u.email, subject: title, text: `${body}\n\nAdjust the cap in Admin if needed.` }).catch(
      () => {},
    );
  }
  getLogger().warn({ spend, capUsd }, "cap alert raised");
}

/** Global pause: halts agent activity and scheduled tasks, backups exempt. */
export async function isGloballyPaused(): Promise<boolean> {
  const rows = await getDb().select().from(appMeta).where(eq(appMeta.key, "global.pause")).limit(1);
  return Boolean((rows[0]?.value as { paused?: boolean } | null)?.paused);
}

export async function setGlobalPause(paused: boolean) {
  await getDb()
    .insert(appMeta)
    .values({ key: "global.pause", value: { paused } })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: { paused }, updatedAt: new Date() } });
}
