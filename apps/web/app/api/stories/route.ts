import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { embedText } from "@/lib/ai/run";

export const dynamic = "force-dynamic";

const storyText = (s: { title: string; competency: string; situation?: string; task?: string; action?: string; result?: string }) =>
  [s.title, s.competency, s.situation, s.task, s.action, s.result].filter(Boolean).join("\n");

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  competency: z.string().trim().min(1).max(120),
  situation: z.string().max(4000).optional(),
  task: z.string().max(4000).optional(),
  action: z.string().max(4000).optional(),
  result: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, createSchema);
  if (!guard.ok) return guard.res;
  const embedding = await embedText(guard.user.id, storyText(guard.body)).catch(() => null);
  const story = await scopeFor(guard.user.id).createStory({ ...guard.body, embedding });
  return NextResponse.json({ ok: true, id: story.id });
}

const patchSchema = createSchema.partial().extend({ id: z.string().uuid() });

export async function PATCH(req: Request) {
  const guard = await guardedBody(req, patchSchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const { id, ...patch } = guard.body;
  // recompute the embedding when any STAR field changed
  let embedding: number[] | undefined;
  if (Object.keys(patch).length > 0) {
    const existing = (await scope.listStories()).find((s) => s.id === id);
    if (!existing) return jsonError("story not found", 404);
    const merged = { ...existing, ...patch } as Parameters<typeof storyText>[0];
    const vec = await embedText(guard.user.id, storyText(merged)).catch(() => null);
    if (vec) embedding = vec;
  }
  const updated = await scope.updateStory(id, { ...patch, ...(embedding ? { embedding } : {}) });
  return updated ? NextResponse.json({ ok: true }) : jsonError("story not found", 404);
}

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, z.object({ id: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  const ok = await scopeFor(guard.user.id).deleteStory(guard.body.id);
  return ok ? NextResponse.json({ ok: true }) : jsonError("story not found", 404);
}
