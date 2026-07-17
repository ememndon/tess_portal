import { NextResponse } from "next/server";
import { recordLinkClick } from "@/lib/server/outreach";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public tracked-link redirect. A hiring manager clicking a portfolio
 * link hits this, the click is logged against the job, and they are
 * sent on to the real URL. Only pre-registered URLs (by token) are
 * ever redirected to, so this cannot be used as an open redirect.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{24}$/.test(token)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const url = await recordLinkClick(token);
  if (!url) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
