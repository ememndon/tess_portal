import { NextResponse } from "next/server";
import { apiUser } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { searchAll } from "@/lib/server/search";
import { getLogger } from "@/lib/server/health";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ groups: [] });
  try {
    const groups = await searchAll(user.id, q.slice(0, 200));
    return NextResponse.json({ groups: groups.filter((g) => g.hits.length > 0) });
  } catch (err) {
    getLogger().error({ err: (err as Error).message }, "search failed");
    return jsonError("search is unavailable right now", 503);
  }
}
