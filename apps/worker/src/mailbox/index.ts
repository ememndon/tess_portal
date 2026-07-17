import type { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { processMailOutbox } from "./send";
import { syncAccount, fetchBody, applyMailOp, unsnoozeDue, type MailOp } from "./sync";

/**
 * The mailbox worker: a fast outbound send loop (so undo-send delays are
 * honoured to the second), a periodic IMAP sync of every connected
 * account, and Redis triggers — `mail:send` wakes the send loop,
 * `mail:sync <userId>` runs an initial backfill after connect,
 * `mail:fetchbody <userId>|<messageId>` downloads a body on open, and
 * `mail:op <json>` mirrors a UI action (read/star/move/trash) to IMAP.
 */
export async function startMailboxWorker(
  db: Db,
  redis: Redis,
  log: Logger,
): Promise<() => Promise<void>> {
  let sending = false;
  const sendTick = async () => {
    if (sending) return;
    sending = true;
    try {
      await processMailOutbox(db, log);
    } catch (err) {
      log.error({ err: (err as Error).message }, "mail send loop error");
    } finally {
      sending = false;
    }
  };
  const sendInterval = setInterval(() => void sendTick(), 5000);

  let syncing = false;
  const syncTick = async () => {
    if (syncing) return;
    syncing = true;
    try {
      // resurface any snoozed mail whose time has come, before pulling new mail
      try {
        const woke = await unsnoozeDue(db);
        if (woke) log.info({ count: woke }, "un-snoozed due messages");
      } catch (err) {
        log.warn({ err: (err as Error).message }, "un-snooze sweep failed");
      }
      const accounts = await db
        .select({ userId: schema.mailAccounts.userId })
        .from(schema.mailAccounts)
        .where(eq(schema.mailAccounts.status, "active"));
      for (const a of accounts) {
        try {
          await syncAccount(db, log, a.userId, {});
        } catch (err) {
          log.warn({ user: a.userId, err: (err as Error).message }, "periodic mailbox sync failed");
        }
      }
    } finally {
      syncing = false;
    }
  };
  const syncInterval = setInterval(() => void syncTick(), 120_000);

  const sub = redis.duplicate();
  await sub.subscribe("mail:send", "mail:sync", "mail:fetchbody", "mail:op");
  sub.on("message", (channel, message) => {
    if (channel === "mail:send") {
      void sendTick();
    } else if (channel === "mail:sync") {
      syncAccount(db, log, message, { backfill: true })
        .then((n) => log.info({ user: message, found: n }, "mailbox backfill complete"))
        .catch((err) => log.warn({ err: (err as Error).message }, "mailbox backfill failed"));
    } else if (channel === "mail:fetchbody") {
      const [userId, messageId] = message.split("|");
      if (userId && messageId) {
        fetchBody(db, log, userId, messageId).catch((err) =>
          log.warn({ err: (err as Error).message }, "body fetch failed"),
        );
      }
    } else if (channel === "mail:op") {
      try {
        const { userId, op } = JSON.parse(message) as { userId: string; op: MailOp };
        if (userId && op) {
          applyMailOp(db, log, userId, op).catch((err) =>
            log.warn({ err: (err as Error).message }, "mail op failed"),
          );
        }
      } catch {
        // ignore malformed op
      }
    }
  });

  // kick an initial sync a few seconds after boot
  const boot = setTimeout(() => void syncTick(), 8000);

  log.info("mailbox worker started");
  return async () => {
    clearInterval(sendInterval);
    clearInterval(syncInterval);
    clearTimeout(boot);
    await sub.quit().catch(() => {});
  };
}
