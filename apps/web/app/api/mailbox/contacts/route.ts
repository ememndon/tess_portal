import { NextResponse } from "next/server";
import { apiUser } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

/** Address-book autocomplete for compose (To/Cc/Bcc). */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const rows = await scopeFor(user.id).searchContacts(q, 8);
  return NextResponse.json({ contacts: rows });
}
