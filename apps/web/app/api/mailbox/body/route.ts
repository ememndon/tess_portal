import { setTimeout as sleep } from "node:timers/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { getRedis } from "@/lib/server/health";
import { sanitizeEmailHtml } from "@/lib/server/mail-sanitize";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  messageId: z.string().uuid(),
  loadImages: z.boolean().optional(),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns a message body as sanitized, render-safe HTML. Downloads the
 * body on first open (via the worker), waits briefly for it, marks the
 * message read, and blocks remote images unless loadImages is set.
 */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  let msg = await scope.getMailMessage(guard.body.messageId);
  if (!msg) return jsonError("message not found", 404);

  if (!msg.bodyFetched) {
    await getRedis().publish("mail:fetchbody", `${guard.user.id}|${msg.id}`);
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      const fresh = await scope.getMailMessage(msg.id);
      if (fresh?.bodyFetched) {
        msg = fresh;
        break;
      }
    }
  }

  // opening a message marks it read (optimistic + mirror to IMAP)
  if (!msg.isRead) {
    await scope.setMailRead(msg.id, true);
    await getRedis()
      .publish(
        "mail:op",
        JSON.stringify({
          userId: guard.user.id,
          op: { type: "flag", messageId: msg.id, flag: "\\Seen", add: true },
        }),
      )
      .catch(() => {});
  }

  const atts = await scope.listMailAttachments(msg.id);
  const cidMap = new Map<string, string>();
  for (const a of atts) {
    if (a.contentId) cidMap.set(a.contentId.replace(/^<|>$/g, ""), a.id);
  }

  let html = "";
  let hasRemoteImages = false;
  if (msg.bodyFetched && msg.bodyHtml) {
    const r = sanitizeEmailHtml(msg.bodyHtml, {
      loadImages: Boolean(guard.body.loadImages),
      userId: guard.user.id,
      cidMap,
    });
    html = r.html;
    hasRemoteImages = r.hasRemoteImages;
  } else if (msg.bodyText) {
    html = `<pre style="white-space:pre-wrap;font:inherit;margin:0">${escapeHtml(msg.bodyText)}</pre>`;
  } else if (!msg.bodyFetched) {
    html = `<p style="color:#888">Still downloading this message… reopen it in a moment.</p>`;
  }

  return NextResponse.json({
    fetched: msg.bodyFetched,
    html,
    text: msg.bodyText ?? "",
    hasRemoteImages,
    subject: msg.subject,
    from: msg.fromAddr,
    to: msg.toAddrs,
    cc: msg.ccAddrs,
    sentAt: msg.sentAt?.toISOString() ?? null,
    messageIdHdr: msg.messageIdHdr,
    referencesHdrs: msg.referencesHdrs,
    attachments: atts
      .filter((a) => !a.isInline)
      .map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
  });
}
