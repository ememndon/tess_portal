import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { requestIp } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  jobId: z.string().uuid(),
  cvVersionId: z.string().uuid().nullable().optional(),
  coverLetterVersionId: z.string().uuid().nullable().optional(),
  formAnswers: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
});

/** Mark applied: records the exact document versions sent, moves the pipeline. */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const app = await scopeFor(guard.user.id).createApplication({
    jobId: guard.body.jobId,
    cvVersionId: guard.body.cvVersionId ?? null,
    coverLetterVersionId: guard.body.coverLetterVersionId ?? null,
    formAnswers: guard.body.formAnswers ?? null,
  });
  if (!app) return jsonError("job not found", 404);
  await audit({
    userId: guard.user.id,
    action: "application.submitted",
    targetType: "job",
    targetId: guard.body.jobId,
    snapshot: {
      applicationId: app.id,
      cvVersionId: guard.body.cvVersionId ?? null,
      coverLetterVersionId: guard.body.coverLetterVersionId ?? null,
    },
    ip: await requestIp(),
  });
  return NextResponse.json({ ok: true, applicationId: app.id });
}
