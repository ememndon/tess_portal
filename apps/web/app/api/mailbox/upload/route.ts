import { NextResponse } from "next/server";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const MAX_FILE = 25 * 1024 * 1024; // 25 MB, Gmail-interop

/** Uploads a compose attachment, stored until the message is sent. */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  if (!(await sameOrigin())) return jsonError("bad origin", 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("expected a file upload", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("no file", 400);
  if (file.size > MAX_FILE) return jsonError("file is larger than 25 MB", 413);

  const buf = Buffer.from(await file.arrayBuffer());
  const row = await scopeFor(user.id).createMailUpload({
    filename: file.name || "attachment",
    contentType: file.type || "application/octet-stream",
    sizeBytes: buf.length,
    content: buf.toString("base64"),
  });
  return NextResponse.json({ id: row.id, filename: row.filename, sizeBytes: row.sizeBytes });
}

/** Removes a pending upload (user removed it from the draft). */
export async function DELETE(req: Request) {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return jsonError("no id", 400);
  await scopeFor(user.id).deleteMailUpload(id);
  return NextResponse.json({ ok: true });
}
