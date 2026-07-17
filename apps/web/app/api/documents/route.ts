import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const MAX_SIZE = 8 * 1024 * 1024;
const KINDS = ["cv_base", "cv_tailored", "cover_letter", "other"] as const;

/** Multipart upload: file, title, kind, optional documentId for a new version. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("invalid upload", 400);
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("attach a file", 400);
  if (file.size === 0 || file.size > MAX_SIZE) {
    return jsonError("the file must be between 1 byte and 8 MB", 400);
  }
  const kind = String(form.get("kind") ?? "other");
  const title = String(form.get("title") ?? file.name).trim().slice(0, 200);
  const note = String(form.get("note") ?? "").slice(0, 500) || undefined;
  const documentId = String(form.get("documentId") ?? "") || null;
  if (!KINDS.includes(kind as (typeof KINDS)[number])) return jsonError("unknown kind", 400);

  const contentBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const scope = scopeFor(user.id);

  if (documentId) {
    const version = await scope.addDocumentVersion(documentId, {
      fileName: file.name,
      mime: file.type || "application/octet-stream",
      contentBase64,
      note,
    });
    if (!version) return jsonError("document not found", 404);
    return NextResponse.json({ ok: true, documentId, versionId: version.id });
  }

  const doc = await scope.createDocument({
    kind,
    title: title || file.name,
    fileName: file.name,
    mime: file.type || "application/octet-stream",
    contentBase64,
    note,
  });
  return NextResponse.json({ ok: true, documentId: doc.id });
}

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, z.object({ id: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  const ok = await scopeFor(guard.user.id).deleteDocument(guard.body.id);
  return ok ? NextResponse.json({ ok: true }) : jsonError("document not found", 404);
}
