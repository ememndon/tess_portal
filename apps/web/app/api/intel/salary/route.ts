import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { salaryBands, negotiationScript } from "@/lib/intel/salary";
import { PICKABLE_CURRENCIES } from "@/lib/currency";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** An explicit reporting currency, or undefined to use each market's own. */
const currencySchema = z.enum(PICKABLE_CURRENCIES).optional();

/** Salary bands aggregated per role and market from the user's jobs. */
export async function GET(req: Request) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const raw = new URL(req.url).searchParams.get("currency") ?? undefined;
  const parsed = currencySchema.safeParse(raw);
  if (!parsed.success) return jsonError("unsupported currency", 400);
  const bands = await salaryBands(user.id, { currency: parsed.data });
  return NextResponse.json({ ok: true, bands });
}

const scriptSchema = z.object({
  role: z.string().trim().min(1).max(160),
  market: z.string().trim().max(60).optional(),
  currentOffer: z.coerce.number().int().min(0).max(100_000_000).optional(),
  currency: currencySchema,
});

/** Generates a data-grounded negotiation script for a role and market. */
export async function POST(req: Request) {
  const guard = await guardedBody(req, scriptSchema);
  if (!guard.ok) return guard.res;
  const result = await negotiationScript(guard.user.id, guard.body);
  return NextResponse.json({ ok: true, ...result });
}
