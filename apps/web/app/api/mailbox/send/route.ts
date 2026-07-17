import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const addr = z.object({ name: z.string().max(200).optional(), address: z.string().email() });

const bodySchema = z.object({
  idempotencyKey: z.string().uuid(),
  to: z.array(addr).min(1).max(50),
  cc: z.array(addr).max(50).optional(),
  bcc: z.array(addr).max(50).optional(),
  subject: z.string().max(1000).default(""),
  html: z.string().max(500_000).optional(),
  text: z.string().max(500_000).optional(),
  inReplyTo: z.string().max(1000).optional(),
  references: z.string().max(4000).optional(),
  attachmentIds: z.array(z.string().uuid()).max(25).optional(),
  sendAt: z.string().datetime().optional(),
  draftId: z.string().uuid().optional(),
});

/** Undo-send window: the queued mail sits here before the worker dispatches it. */
const UNDO_SECONDS = 15;

/**
 * Enqueues an outbound message. Nothing is sent synchronously — a worker
 * picks it up after the undo window, so undo-send and retries come free.
 */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const account = await scope.getMailAccount();
  if (!account) return jsonError("no mailbox is connected", 400);

  const b = guard.body;
  if (!b.html && !b.text) return jsonError("the message is empty", 400);

  // validate attachments belong to this user and fit the size cap
  let attachmentIds: string[] = [];
  if (b.attachmentIds && b.attachmentIds.length) {
    const owned = await scope.mailUploadsMeta(b.attachmentIds);
    if (owned.length !== b.attachmentIds.length) return jsonError("an attachment is missing", 400);
    const total = owned.reduce((n, a) => n + (a.sizeBytes ?? 0), 0);
    if (total > 25 * 1024 * 1024) return jsonError("attachments exceed 25 MB in total", 413);
    attachmentIds = b.attachmentIds;
  }

  // schedule-send vs immediate (with undo window)
  let sendAfter: Date;
  let status = "queued";
  if (b.sendAt) {
    const d = new Date(b.sendAt);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 60_000) {
      return jsonError("pick a time at least a minute from now", 400);
    }
    sendAfter = d;
    status = "scheduled";
  } else {
    sendAfter = new Date(Date.now() + UNDO_SECONDS * 1000);
  }

  // Mint the Message-ID once, here, so every retry re-sends the identical
  // one and recipients de-duplicate rather than seeing a copy per attempt.
  const domain = account.email.split("@")[1] || "mail.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const row = await scope.enqueueMailSend({
    accountId: account.id,
    idempotencyKey: b.idempotencyKey,
    status,
    payload: {
      to: b.to,
      cc: b.cc ?? [],
      bcc: b.bcc ?? [],
      subject: b.subject,
      html: b.html,
      text: b.text,
      inReplyTo: b.inReplyTo,
      references: b.references,
      messageId,
      attachmentIds,
    },
    sendAfter,
  });
  if (!row) return jsonError("could not queue the message", 500);

  // sent successfully → drop the autosaved draft
  if (b.draftId) await scope.deleteMailDraft(b.draftId).catch(() => {});

  return NextResponse.json({
    ok: true,
    id: row.id,
    sendAfter: sendAfter.toISOString(),
    undoSeconds: status === "scheduled" ? 0 : UNDO_SECONDS,
    scheduled: status === "scheduled",
  });
}
