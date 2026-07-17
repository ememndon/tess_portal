import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { scopeFor, JOB_STAGES } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  stage: z.enum(JOB_STAGES).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  companyName: z.string().trim().min(1).max(160).optional(),
  location: z.string().trim().max(120).nullable().optional(),
  url: z.string().url().max(2000).nullable().optional().or(z.literal("")),
  description: z.string().max(60000).nullable().optional(),
  salaryRaw: z.string().max(200).nullable().optional(),
  sponsorship: z.enum(["yes", "no", "inferred", "unknown"]).optional(),
  note: z.string().trim().min(1).max(10000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardedBody(req, patchSchema);
  if (!guard.ok) return guard.res;
  const { id } = await params;
  const scope = scopeFor(guard.user.id);
  const { stage, note, url, ...fields } = guard.body;

  if (note) {
    const activity = await scope.addJobNote(id, note);
    if (!activity) return jsonError("job not found", 404);
  }
  if (stage) {
    const job = await scope.moveJobStage(id, stage);
    if (!job) return jsonError("job not found", 404);
  }
  if (Object.keys(fields).length > 0 || url !== undefined) {
    const job = await scope.updateJob(id, {
      ...fields,
      ...(url !== undefined ? { url: url || null } : {}),
    });
    if (!job) return jsonError("job not found", 404);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const { id } = await params;
  const ok = await scopeFor(user.id).deleteJob(id);
  return ok ? NextResponse.json({ ok: true }) : jsonError("job not found", 404);
}
