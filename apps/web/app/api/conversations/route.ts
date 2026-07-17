import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { apiUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { getRouting, listAvailableModels } from "@/lib/ai/router";
import { isGloballyPaused } from "@/lib/ai/meter";

export const dynamic = "force-dynamic";

/**
 * Read side for the Tess right-rail. Without a query it returns the
 * conversation list plus chat meta (models, default label, paused);
 * with ?id=<uuid> it returns that conversation's messages. Everything is
 * scoped to the caller through the DAL.
 */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const scope = scopeFor(user.id);
  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    const convo = await scope.getConversation(id);
    if (!convo) return jsonError("conversation not found", 404);
    const history = await scope.listMessages(id);
    return NextResponse.json({
      model: convo.model,
      messages: history.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls ?? null,
      })),
    });
  }

  const [conversations, models, defaultRouting, paused] = await Promise.all([
    scope.listConversations(),
    listAvailableModels(),
    getRouting("chat"),
    isGloballyPaused(),
  ]);
  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt.toISOString(),
    })),
    models,
    defaultModelLabel:
      defaultRouting.provider === "auto" ? "Free chain" : `${defaultRouting.provider} · ${defaultRouting.model}`,
    paused,
  });
}

export async function POST(req: Request) {
  const guard = await guardedBody(req, z.object({ model: z.string().max(120).nullable().optional() }));
  if (!guard.ok) return guard.res;
  const convo = await scopeFor(guard.user.id).createConversation(guard.body.model ?? null);
  return NextResponse.json({ ok: true, id: convo.id });
}

export async function PATCH(req: Request) {
  const guard = await guardedBody(
    req,
    z.object({ id: z.string().uuid(), model: z.string().max(120).nullable() }),
  );
  if (!guard.ok) return guard.res;
  const updated = await scopeFor(guard.user.id).setConversationModel(guard.body.id, guard.body.model);
  return updated
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "conversation not found" }, { status: 404 });
}

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, z.object({ id: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  const ok = await scopeFor(guard.user.id).deleteConversation(guard.body.id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "conversation not found" }, { status: 404 });
}
