import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

/** Download a version. Own documents only, enforced in the DAL. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const { id } = await params;
  const version = await scopeFor(user.id).getDocumentVersionFile(id);
  if (!version) return jsonError("not found", 404);
  return new Response(Buffer.from(version.content, "base64"), {
    headers: {
      "Content-Type": version.mime,
      "Content-Disposition": `attachment; filename="${version.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Link or unlink the version to a job, the went-where record. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const guard = await guardedBody(req, z.object({ jobId: z.string().uuid().nullable() }));
  if (!guard.ok) return guard.res;
  const { id } = await params;
  const ok = await scopeFor(guard.user.id).linkVersionToJob(id, guard.body.jobId);
  return ok ? NextResponse.json({ ok: true }) : jsonError("not found", 404);
}
