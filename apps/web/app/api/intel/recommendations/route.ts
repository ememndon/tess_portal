import { NextResponse } from "next/server";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { recommendCompanies } from "@/lib/intel/recommend";

export const dynamic = "force-dynamic";

/** Proactive company recommendations from the user's own data. */
export async function GET() {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const recommendations = await recommendCompanies(user.id);
  return NextResponse.json({ ok: true, recommendations });
}
