import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const countrySchema = z.object({
  code: z.string().length(2).nullable(),
  name: z.string().trim().min(1).max(80),
});

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().min(1).max(100).optional(),
  targetCountries: z.array(countrySchema).max(50).optional(),
  roleQuery: z.string().trim().max(400).nullable().optional(),
  requireSponsorship: z.boolean().optional(),
  requireFamilyReunification: z.boolean().optional(),
  theme: z.enum(["dark", "light"]).optional(),
});

export async function PATCH(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const { name, ...settings } = guard.body;
  if (name) await scope.updateName(name);
  if (Object.keys(settings).length > 0) await scope.updateSettings(settings);
  return NextResponse.json({ ok: true });
}
