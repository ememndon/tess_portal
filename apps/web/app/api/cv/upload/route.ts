import { NextResponse } from "next/server";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { isGloballyPaused } from "@/lib/ai/meter";
import { extractText } from "@/lib/cv/extract";
import { parseCvToProfile } from "@/lib/cv/parse";
import { getLogger } from "@/lib/server/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX = 8 * 1024 * 1024;

/**
 * CV upload: extract text with mammoth/pdfjs, structure it into the
 * strict profile schema with the LLM, save as a DRAFT, and return it
 * for the mandatory review step. The original file is also stored as a
 * base CV document.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  if (await isGloballyPaused()) return jsonError("the platform is paused by an admin", 503);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("attach a CV file", 400);
  if (file.size === 0 || file.size > MAX) return jsonError("the file must be between 1 byte and 8 MB", 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const scope = scopeFor(user.id);

  let text: string;
  try {
    text = await extractText(buffer, file.type || "", file.name);
  } catch (err) {
    getLogger().error({ err: (err as Error).message }, "cv extraction failed");
    return jsonError("could not read that file, try a DOCX or a text-based PDF", 422);
  }
  if (text.replace(/\s+/g, " ").trim().length < 80) {
    return jsonError("that file has almost no readable text, it may be image-only", 422);
  }

  let profile;
  try {
    profile = await parseCvToProfile(user.id, text);
  } catch (err) {
    getLogger().error({ err: (err as Error).message }, "cv parse failed");
    return jsonError((err as Error).message.includes("provider") ? "no AI provider is available, add an API key in Admin" : "could not structure that CV, try again", 503);
  }

  // keep the original as a base CV document, and the draft profile
  await scope.createDocument({
    kind: "cv_base",
    title: file.name.replace(/\.[^.]+$/, "") || "CV",
    fileName: file.name,
    mime: file.type || "application/octet-stream",
    contentBase64: buffer.toString("base64"),
    note: "Original uploaded CV",
  });
  await scope.saveDraftProfile(profile);

  return NextResponse.json({ ok: true, profile });
}
