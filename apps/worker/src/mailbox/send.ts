import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { getMailContext, openImap, specialFolderPath, type MailContext } from "./imap";

/**
 * Outbound send loop. The API writes a mail_outbox row (send_after =
 * now + undo delay) carrying a pre-minted Message-ID; this loop claims
 * due rows one at a time, builds the MIME, submits over SMTP, records
 * the send, then APPENDs the copy to Sent.
 *
 * Correctness invariants (an email is an unrecallable side effect):
 *  - The Message-ID is generated ONCE at enqueue and reused on every
 *    retry, so if a send is ever retried the recipient de-dups it.
 *  - After transport.sendMail returns, nothing below may throw upward:
 *    the row is marked sent (with retry) and APPEND failures are
 *    swallowed, so a post-send DB blip can never re-transmit.
 *  - A reaper reclaims rows stuck in 'sending' (crash mid-dispatch);
 *    reclaimed rows re-send with the same Message-ID, so still dedup-safe.
 */

type Addr = { name?: string; address: string };
type SendPayload = {
  to: Addr[];
  cc?: Addr[];
  bcc?: Addr[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  messageId?: string;
  attachmentIds?: string[];
};

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000]; // 1m 5m 15m 1h 6h
const RATE_PER_HOUR = 50;
const STUCK_SENDING_MS = 5 * 60_000; // reclaim a 'sending' row older than this

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRaw(options: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    new MailComposer(options).compile().build((err: Error | null, message: Buffer) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

function isPermanent(err: Error): boolean {
  const code = (err as { responseCode?: number }).responseCode;
  return typeof code === "number" && code >= 500 && code < 600;
}

/** Marks a row sent, retrying the write so a transient DB error cannot
 * bubble up (which would re-transmit). Returns false if it never lands. */
async function markSentWithRetry(db: Db, id: string): Promise<boolean> {
  for (let i = 0; i < 6; i++) {
    try {
      await db
        .update(schema.mailOutbox)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(schema.mailOutbox.id, id));
      return true;
    } catch {
      await sleep(500 * (i + 1));
    }
  }
  return false;
}

async function dispatchOne(
  db: Db,
  log: Logger,
  ctx: MailContext,
  row: typeof schema.mailOutbox.$inferSelect,
): Promise<void> {
  const payload = row.payload as SendPayload;
  const to = (payload.to ?? []).filter((a) => a.address);
  const cc = (payload.cc ?? []).filter((a) => a.address);
  const bcc = (payload.bcc ?? []).filter((a) => a.address);
  const domain = ctx.account.email.split("@")[1] || "localhost";
  const messageId = payload.messageId ?? `<${randomUUID()}@${domain}>`;
  const html = payload.html;
  const text = payload.text ?? (html ? stripHtml(html) : "");

  // load compose attachments (bytes stored in mail_uploads until send)
  const attIds = payload.attachmentIds ?? [];
  const attachments =
    attIds.length > 0
      ? (
          await db
            .select()
            .from(schema.mailUploads)
            .where(and(eq(schema.mailUploads.userId, row.userId), inArray(schema.mailUploads.id, attIds)))
        ).map((u) => ({
          filename: u.filename,
          content: Buffer.from(u.content, "base64"),
          contentType: u.contentType,
        }))
      : [];

  const mailOptions = {
    from: { name: ctx.account.displayName || "", address: ctx.account.email },
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject: payload.subject ?? "",
    html: html || undefined,
    text,
    attachments: attachments.length ? attachments : undefined,
    messageId,
    inReplyTo: payload.inReplyTo || undefined,
    references: payload.references || undefined,
    headers: { "X-Mailer": "Tess Portal" },
  };

  const raw = await buildRaw(mailOptions);

  const transport = nodemailer.createTransport({
    host: ctx.smtp.host,
    port: ctx.smtp.port,
    secure: ctx.smtp.secure,
    requireTLS: !ctx.smtp.secure,
    auth: { user: ctx.smtp.user, pass: ctx.smtp.pass },
    connectionTimeout: 15000,
    socketTimeout: 30000,
  });

  const recipients = [...to, ...cc, ...bcc].map((a) => a.address);
  // The only line allowed to throw upward (→ retry). Everything after the
  // mail is accepted must not, or we would re-transmit.
  try {
    await transport.sendMail({ envelope: { from: ctx.account.email, to: recipients }, raw });
  } finally {
    transport.close();
  }

  const recorded = await markSentWithRetry(db, row.id);
  if (!recorded) {
    log.error(
      { id: row.id },
      "mail sent but status write failed; reaper will reconcile (same Message-ID, dedup-safe)",
    );
    return; // do NOT throw — must not requeue an already-sent message
  }

  // attachments consumed — remove the pending uploads (best-effort)
  if (attIds.length) {
    try {
      await db
        .delete(schema.mailUploads)
        .where(and(eq(schema.mailUploads.userId, row.userId), inArray(schema.mailUploads.id, attIds)));
    } catch {
      /* non-fatal */
    }
  }

  // File a copy in Sent (Gmail auto-files; skip there). Best-effort.
  if (!/gmail|googlemail/i.test(ctx.imap.host)) {
    const sentPath = (await specialFolderPath(db, row.userId, "sent")) ?? "Sent";
    const client = openImap(ctx.imap);
    try {
      await client.connect();
      await client.append(sentPath, raw, ["\\Seen"]);
      await client.logout();
    } catch (err) {
      log.warn({ user: row.userId, err: (err as Error).message }, "APPEND to Sent failed (mail was sent)");
      client.close();
    }
  }
  log.info({ user: row.userId, to: recipients.length, messageId }, "mail sent");
}

async function underRateLimit(db: Db, userId: string): Promise<boolean> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.mailOutbox)
    .where(
      and(
        eq(schema.mailOutbox.userId, userId),
        eq(schema.mailOutbox.status, "sent"),
        gte(schema.mailOutbox.sentAt, new Date(Date.now() - 3_600_000)),
      ),
    );
  return Number(n) < RATE_PER_HOUR;
}

/** Reclaims rows stranded in 'sending' by a crash/restart mid-dispatch. */
async function reapStuck(db: Db): Promise<void> {
  await db
    .update(schema.mailOutbox)
    .set({ status: "queued", sendAfter: new Date() })
    .where(
      and(
        eq(schema.mailOutbox.status, "sending"),
        lt(schema.mailOutbox.claimedAt, new Date(Date.now() - STUCK_SENDING_MS)),
      ),
    );
}

/** Claims and processes all currently-due outbox rows. Safe to run often. */
export async function processMailOutbox(db: Db, log: Logger): Promise<number> {
  await reapStuck(db);
  let handled = 0;
  for (let i = 0; i < 25; i++) {
    const row = await db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(schema.mailOutbox)
        .where(
          and(
            inArray(schema.mailOutbox.status, ["queued", "scheduled"]),
            lte(schema.mailOutbox.sendAfter, new Date()),
          ),
        )
        .orderBy(asc(schema.mailOutbox.sendAfter))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!r) return null;
      await tx
        .update(schema.mailOutbox)
        .set({ status: "sending", claimedAt: new Date() })
        .where(eq(schema.mailOutbox.id, r.id));
      return r;
    });
    if (!row) break;

    if (!(await underRateLimit(db, row.userId))) {
      await db
        .update(schema.mailOutbox)
        .set({ status: "queued", sendAfter: new Date(Date.now() + 600_000) })
        .where(eq(schema.mailOutbox.id, row.id));
      continue;
    }

    const ctx = await getMailContext(db, row.userId);
    if (!ctx) {
      await db
        .update(schema.mailOutbox)
        .set({ status: "failed", lastError: "mailbox not connected" })
        .where(eq(schema.mailOutbox.id, row.id));
      continue;
    }

    try {
      await dispatchOne(db, log, ctx, row);
      handled += 1;
    } catch (err) {
      const e = err as Error;
      const attempts = row.attempts + 1;
      if (isPermanent(e) || attempts >= MAX_ATTEMPTS) {
        await db
          .update(schema.mailOutbox)
          .set({ status: "failed", attempts, lastError: e.message.slice(0, 500) })
          .where(eq(schema.mailOutbox.id, row.id));
        log.warn({ user: row.userId, err: e.message }, "mail send failed permanently");
      } else {
        const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
        await db
          .update(schema.mailOutbox)
          .set({
            status: "queued",
            attempts,
            sendAfter: new Date(Date.now() + delay),
            nextRetryAt: new Date(Date.now() + delay),
            lastError: e.message.slice(0, 500),
          })
          .where(eq(schema.mailOutbox.id, row.id));
        log.warn({ user: row.userId, err: e.message, attempts }, "mail send failed, will retry");
      }
    }
  }
  return handled;
}
