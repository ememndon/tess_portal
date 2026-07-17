import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/server/auth";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

type Addr = { name?: string; address: string };

/** The "Snoozed" view: messages hidden until their snooze time. */
export async function GET() {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const rows = await scopeFor(user.id).listSnoozed();
  return NextResponse.json({
    messages: rows.map((m) => ({
      id: m.id,
      subject: m.subject,
      from: (m.fromAddr as Addr) ?? { address: "" },
      snoozedUntil: m.snoozedUntil?.toISOString() ?? null,
    })),
  });
}

const bodySchema = z.object({
  messageId: z.string().uuid(),
  // an absolute instant (computed client-side in the user's timezone), or null to un-snooze
  until: z.string().datetime().nullable(),
});

/** Snoozes a message until `until`, or resurfaces it now when `until` is null. */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const until = guard.body.until ? new Date(guard.body.until) : null;
  if (until && until.getTime() <= Date.now()) return jsonError("snooze time must be in the future", 400);
  const ok = await scopeFor(guard.user.id).snoozeMessage(guard.body.messageId, until);
  if (!ok) return jsonError("message not found", 404);
  return NextResponse.json({ ok: true });
}
