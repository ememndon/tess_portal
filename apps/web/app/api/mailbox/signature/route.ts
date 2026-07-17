import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ html: z.string().max(50_000) });

/** Saves the account signature (auto-inserted into new mail and replies). */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  await scopeFor(guard.user.id).updateMailSignature(guard.body.html);
  return NextResponse.json({ ok: true });
}
