import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  jobId: z.string().uuid(),
  baseSalary: z.string().regex(/^\d+(\.\d+)?$/, "salary must be a number").optional(),
  currency: z.string().trim().min(3).max(3),
  period: z.enum(["year", "month", "day", "hour"]),
  bonus: z.string().trim().max(300).optional(),
  equity: z.string().trim().max(300).optional(),
  benefits: z.string().trim().max(2000).optional(),
  relocation: z.string().trim().max(300).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(5000).optional(),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, createSchema);
  if (!guard.ok) return guard.res;
  const offer = await scopeFor(guard.user.id).createOffer(guard.body);
  if (!offer) return jsonError("job not found", 404);
  return NextResponse.json({ ok: true, id: offer.id });
}

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, z.object({ id: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  const ok = await scopeFor(guard.user.id).deleteOffer(guard.body.id);
  return ok ? NextResponse.json({ ok: true }) : jsonError("offer not found", 404);
}
