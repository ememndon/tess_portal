import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { getRedis } from "@/lib/server/health";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  messageId: z.string().uuid(),
  action: z.enum(["read", "unread", "star", "unstar", "archive", "trash", "spam"]),
});

/** A mailbox action: update the DB optimistically, mirror it to IMAP via the worker. */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const { messageId, action } = guard.body;
  const msg = await scope.getMailMessage(messageId);
  if (!msg) return jsonError("message not found", 404);

  let op: Record<string, unknown> | null = null;
  switch (action) {
    case "read":
      await scope.setMailRead(messageId, true);
      op = { type: "flag", messageId, flag: "\\Seen", add: true };
      break;
    case "unread":
      await scope.setMailRead(messageId, false);
      op = { type: "flag", messageId, flag: "\\Seen", add: false };
      break;
    case "star":
      await scope.setMailStar(messageId, true);
      op = { type: "flag", messageId, flag: "\\Flagged", add: true };
      break;
    case "unstar":
      await scope.setMailStar(messageId, false);
      op = { type: "flag", messageId, flag: "\\Flagged", add: false };
      break;
    case "archive":
      await scope.hideMailMessage(messageId);
      op = { type: "move", messageId, targetSpecial: "archive" };
      break;
    case "spam":
      await scope.hideMailMessage(messageId);
      op = { type: "move", messageId, targetSpecial: "junk" };
      break;
    case "trash":
      await scope.hideMailMessage(messageId);
      op = { type: "trash", messageId };
      break;
  }

  if (op) {
    await getRedis()
      .publish("mail:op", JSON.stringify({ userId: guard.user.id, op }))
      .catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
