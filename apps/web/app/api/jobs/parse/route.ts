import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { parsePastedJob } from "@/lib/server/paste-parser";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await guardedBody(req, z.object({ text: z.string().min(20).max(60000) }));
  if (!guard.ok) return guard.res;
  const parsed = await parsePastedJob(guard.body.text);
  return NextResponse.json({ ok: true, parsed });
}
