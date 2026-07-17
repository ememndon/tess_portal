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
  name: z.string().trim().min(1, "enter your name").max(200),
  timezone: z.string().min(1).max(100),
  targetCountries: z.array(countrySchema).max(50),
  roleQuery: z.string().trim().max(400).nullable().optional(),
  theme: z.enum(["dark", "light"]),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  await scope.updateName(guard.body.name);
  await scope.updateSettings({
    timezone: guard.body.timezone,
    targetCountries: guard.body.targetCountries,
    roleQuery: guard.body.roleQuery ?? null,
    theme: guard.body.theme,
  });
  await scope.markOnboarded();
  return NextResponse.json({ ok: true });
}
