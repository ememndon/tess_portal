import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { and, count, eq, isNull } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { getDb } from "./db";
import { getLogger, getRedis } from "./health";

const { notifications } = schema;

/**
 * Notification center: DB-backed records plus live SSE fan-out through
 * Redis pub/sub, so any web process can deliver to any connected user.
 */

const g = globalThis as unknown as {
  __tpNotifyBus?: EventEmitter;
  __tpNotifySub?: Redis;
};

export function notifyBus(): EventEmitter {
  if (!g.__tpNotifyBus) {
    g.__tpNotifyBus = new EventEmitter();
    g.__tpNotifyBus.setMaxListeners(200);
    const sub = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
    sub.on("error", (err) => getLogger().error({ err: err.message }, "notify subscriber error"));
    sub.psubscribe("notify:*");
    sub.on("pmessage", (_pattern, channel, message) => {
      const userId = channel.slice("notify:".length);
      g.__tpNotifyBus?.emit(userId, message);
    });
    g.__tpNotifySub = sub;
  }
  return g.__tpNotifyBus;
}

export async function unreadCount(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows[0]?.n ?? 0;
}

export async function createNotification(
  userId: string,
  n: { type: string; title: string; body?: string; href?: string },
) {
  const db = getDb();
  const [row] = await db
    .insert(notifications)
    .values({ userId, type: n.type, title: n.title, body: n.body ?? "", href: n.href ?? null })
    .returning();
  const unread = await unreadCount(userId);
  try {
    await getRedis().publish(
      `notify:${userId}`,
      JSON.stringify({ unread, notification: { id: row.id, title: row.title, type: row.type } }),
    );
  } catch (err) {
    getLogger().error({ err: (err as Error).message }, "notification publish failed");
  }
  return row;
}
