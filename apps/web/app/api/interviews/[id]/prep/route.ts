import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { generatePrepPack } from "@/lib/intel/prep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const paramsSchema = z.object({ id: z.string().uuid() });

/** Regenerates the prep pack for an interview on demand. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return jsonError("invalid interview id", 400);

  const detail = await scopeFor(user.id).getInterview(parsed.data.id);
  if (!detail) return jsonError("interview not found", 404);

  const pack = await generatePrepPack(user.id, parsed.data.id);
  if (!pack) return jsonError("could not build a prep pack", 500);
  return NextResponse.json({ ok: true, pack });
}
