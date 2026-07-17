import { apiUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

/** Extensions we serve only as downloads with the true full name shown. */
const DANGEROUS = new Set([
  "exe", "scr", "bat", "cmd", "com", "pif", "msi", "js", "jse", "vbs", "wsf",
  "hta", "jar", "apk", "ps1", "reg", "lnk", "iso", "img",
]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await apiUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const att = await scopeFor(user.id).getMailAttachment(id);
  if (!att || !att.content) return new Response("not found", { status: 404 });

  const ext = att.filename.split(".").pop()?.toLowerCase() ?? "";
  const wantInline = new URL(req.url).searchParams.get("inline") === "1";
  const safeImage = att.contentType.startsWith("image/") && !DANGEROUS.has(ext);
  const inline = wantInline && safeImage;
  const safeName = att.filename.replace(/["\r\n]/g, "");
  const bytes = Buffer.from(att.content, "base64");

  return new Response(new Uint8Array(bytes), {
    headers: {
      // never serve dangerous types with a sniffable/executable content-type
      "Content-Type": DANGEROUS.has(ext) ? "application/octet-stream" : att.contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
