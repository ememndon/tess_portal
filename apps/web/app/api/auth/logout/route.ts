import { NextResponse } from "next/server";
import { revokeCurrentSession, sameOrigin } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  await revokeCurrentSession();
  return NextResponse.json({ ok: true });
}
