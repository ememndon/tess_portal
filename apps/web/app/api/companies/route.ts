import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "enter the company name").max(160),
  website: z.string().url().max(2000).optional().or(z.literal("")),
  countryCode: z.string().length(2).optional(),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, createSchema);
  if (!guard.ok) return guard.res;
  const { website, ...rest } = guard.body;
  const company = await scopeFor(guard.user.id).createCompany({
    ...rest,
    website: website || undefined,
  });
  return NextResponse.json({ ok: true, id: company.id });
}

const actionSchema = z.union([
  z.object({ id: z.string().uuid(), action: z.enum(["watch", "unwatch", "delete"]) }),
  z.object({ companyName: z.string().trim().min(1).max(200), action: z.literal("not-interested") }),
]);

export async function PATCH(req: Request) {
  const guard = await guardedBody(req, actionSchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const body = guard.body;

  if (body.action === "not-interested") {
    const n = await scope.dismissCompanyDiscovered(body.companyName);
    return NextResponse.json({ ok: true, dismissed: n });
  }

  const ok =
    body.action === "delete"
      ? await scope.deleteCompany(body.id)
      : await scope.setCompanyWatch(body.id, body.action === "watch");
  return ok ? NextResponse.json({ ok: true }) : jsonError("company not found", 404);
}
