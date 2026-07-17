import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@tessportal/db";
import { guardedBody, jsonError } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { startPlaybookRun } from "@/lib/server/playbooks";

export const dynamic = "force-dynamic";

const { playbooks, playbookSteps } = schema;

const stepSchema = z.object({
  instruction: z.string().trim().min(3).max(2000),
  mode: z.enum(["auto", "ask_first"]),
});

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  trigger: z.string().trim().max(500).default(""),
  category: z.string().trim().max(60).optional(),
  steps: z.array(stepSchema).min(1).max(20),
});

/** Create or replace a playbook and its steps. */
export async function POST(req: Request) {
  const guard = await guardedBody(req, saveSchema);
  if (!guard.ok) return guard.res;
  const db = getDb();
  const { id, title, trigger, category, steps } = guard.body;

  let playbookId = id ?? null;
  if (playbookId) {
    const [updated] = await db
      .update(playbooks)
      .set({ title, trigger, category: category ?? null, updatedAt: new Date() })
      .where(and(eq(playbooks.id, playbookId), eq(playbooks.userId, guard.user.id)))
      .returning({ id: playbooks.id });
    if (!updated) return jsonError("playbook not found", 404);
    await db
      .delete(playbookSteps)
      .where(and(eq(playbookSteps.playbookId, playbookId), eq(playbookSteps.userId, guard.user.id)));
  } else {
    const [created] = await db
      .insert(playbooks)
      .values({ userId: guard.user.id, title, trigger, category: category ?? null })
      .returning({ id: playbooks.id });
    playbookId = created.id;
  }
  for (let i = 0; i < steps.length; i++) {
    await db.insert(playbookSteps).values({
      userId: guard.user.id,
      playbookId,
      position: i,
      instruction: steps[i].instruction,
      mode: steps[i].mode,
    });
  }
  return NextResponse.json({ ok: true, id: playbookId });
}

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, z.object({ id: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  const [gone] = await getDb()
    .delete(playbooks)
    .where(and(eq(playbooks.id, guard.body.id), eq(playbooks.userId, guard.user.id)))
    .returning({ id: playbooks.id });
  return gone ? NextResponse.json({ ok: true }) : jsonError("playbook not found", 404);
}

/** Run a playbook now. */
export async function PATCH(req: Request) {
  const guard = await guardedBody(req, z.object({ id: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  try {
    const run = await startPlaybookRun(guard.user.id, guard.body.id);
    if (!run) return jsonError("playbook not found", 404);
    return NextResponse.json({ ok: true, runId: run.id });
  } catch (err) {
    return jsonError((err as Error).message, 409);
  }
}
