import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_instruction"), instruction: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("delete_instruction"), id: z.string().uuid() }),
  z.object({ action: z.literal("set_fact"), key: z.string().trim().min(1).max(80), value: z.string().max(500) }),
]);

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const body = guard.body;
  if (body.action === "add_instruction") {
    await scope.addStandingInstruction(body.instruction);
  } else if (body.action === "delete_instruction") {
    await scope.deleteStandingInstruction(body.id);
  } else {
    await scope.updateLearnedProfile({ [body.key]: body.value });
  }
  return NextResponse.json({ ok: true });
}
