import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { buildCompanyBrief } from "@/lib/intel/brief";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const paramsSchema = z.object({ id: z.string().uuid() });

/** Generates and stores a sourced research brief for one company. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return jsonError("invalid company id", 400);

  const scope = scopeFor(user.id);
  const company = await scope.getCompany(parsed.data.id);
  if (!company) return jsonError("company not found", 404);

  const brief = await buildCompanyBrief({
    userId: user.id,
    name: company.name,
    website: company.website,
    sponsorStatus: company.sponsorStatus,
  });
  await scope.saveCompanyBrief(company.id, brief);
  return NextResponse.json({ ok: true, brief });
}
