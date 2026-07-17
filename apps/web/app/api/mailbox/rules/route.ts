import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/server/auth";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const conditionSchema = z.object({
  field: z.enum(["from", "to", "subject", "has_attachment"]),
  op: z.enum(["contains", "not_contains", "equals", "is_true", "is_false"]),
  value: z.string().max(500).optional(),
});
const conditionsSchema = z.object({
  match: z.enum(["all", "any"]),
  rules: z.array(conditionSchema).min(1).max(10),
});
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mark_read") }),
  z.object({ type: z.literal("star") }),
  z.object({ type: z.literal("trash") }),
  z.object({ type: z.literal("move"), folderId: z.string().uuid() }),
]);
const actionsSchema = z.array(actionSchema).min(1).max(6);

/** All of the user's filter rules, in run order. */
export async function GET() {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const rules = await scopeFor(user.id).listMailRules();
  return NextResponse.json({ rules });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  conditions: conditionsSchema,
  actions: actionsSchema,
  stopProcessing: z.boolean().default(true),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, createSchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const account = await scope.getMailAccount();
  if (!account) return jsonError("no mailbox connected", 400);
  const row = await scope.createMailRule({ accountId: account.id, ...guard.body });
  return NextResponse.json({ ok: true, rule: row });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  conditions: conditionsSchema.optional(),
  actions: actionsSchema.optional(),
  stopProcessing: z.boolean().optional(),
  position: z.number().int().optional(),
});

export async function PATCH(req: Request) {
  const guard = await guardedBody(req, patchSchema);
  if (!guard.ok) return guard.res;
  const { id, ...patch } = guard.body;
  const ok = await scopeFor(guard.user.id).updateMailRule(id, patch);
  if (!ok) return jsonError("rule not found", 404);
  return NextResponse.json({ ok: true });
}

const delSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, delSchema);
  if (!guard.ok) return guard.res;
  await scopeFor(guard.user.id).deleteMailRule(guard.body.id);
  return NextResponse.json({ ok: true });
}
