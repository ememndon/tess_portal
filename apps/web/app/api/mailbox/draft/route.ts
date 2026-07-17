import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { apiUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

/** Loads a full draft to reopen in compose. */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonError("no id", 400);
  const d = await scopeFor(user.id).getMailDraft(id);
  if (!d) return jsonError("draft not found", 404);
  return NextResponse.json({
    id: d.id,
    toText: d.toText,
    ccText: d.ccText,
    bccText: d.bccText,
    subject: d.subject,
    html: d.html,
    bodyText: d.bodyText,
    plainMode: d.plainMode,
    attachmentIds: d.attachmentIds,
    inReplyTo: d.inReplyTo,
    referencesHdr: d.referencesHdr,
  });
}

const bodySchema = z.object({
  id: z.string().uuid().nullable().optional(),
  toText: z.string().max(2000).default(""),
  ccText: z.string().max(2000).default(""),
  bccText: z.string().max(2000).default(""),
  subject: z.string().max(1000).default(""),
  html: z.string().max(500_000).default(""),
  bodyText: z.string().max(500_000).default(""),
  plainMode: z.boolean().default(false),
  attachmentIds: z.array(z.string().uuid()).max(25).default([]),
  inReplyTo: z.string().max(1000).nullable().optional(),
  referencesHdr: z.string().max(4000).nullable().optional(),
});

/** Autosaves a compose draft (server-side, so it survives refresh/device). */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const row = await scopeFor(guard.user.id).upsertMailDraft(guard.body);
  return NextResponse.json({ ok: true, id: row?.id });
}

const delSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, delSchema);
  if (!guard.ok) return guard.res;
  await scopeFor(guard.user.id).deleteMailDraft(guard.body.id);
  return NextResponse.json({ ok: true });
}
