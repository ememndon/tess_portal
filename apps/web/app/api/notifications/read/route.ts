import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await guardedBody(req, z.object({}).passthrough());
  if (!guard.ok) return guard.res;
  await scopeFor(guard.user.id).markAllNotificationsRead();
  return NextResponse.json({ ok: true });
}
