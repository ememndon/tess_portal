import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ id: z.string().uuid() });

/** Undo send: cancels a queued message still inside its undo window. */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const ok = await scope.cancelMailSend(guard.body.id);
  return ok ? NextResponse.json({ ok: true }) : jsonError("too late to undo — it has already sent", 409);
}
