import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { findHiringContacts } from "@/lib/server/hiring-finder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The guided hiring-manager finder. Returns suggestions with sources
 * and search links. Nothing is added, the user confirms each one.
 */
export async function POST(req: Request) {
  const guard = await guardedBody(
    req,
    z.object({ company: z.string().trim().min(1).max(160), website: z.string().url().max(500).optional().or(z.literal("")) }),
  );
  if (!guard.ok) return guard.res;
  const result = await findHiringContacts(guard.body.company, guard.body.website || null);
  return NextResponse.json({ ok: true, ...result });
}
