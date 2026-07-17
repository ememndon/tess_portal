import { apiUser } from "@/lib/server/auth";
import { verifyImageUrl } from "@/lib/server/mail-sanitize";
import { assertPublicHost } from "@/lib/server/net-guard";

export const dynamic = "force-dynamic";

/**
 * Remote-image proxy. Only serves URLs signed for this user at sanitize
 * time (no open proxy), rejects private/internal hosts (SSRF), blocks
 * redirects, caps size, and requires an image content-type. This hides
 * the user's IP/UA from trackers and keeps remote fetches off the client.
 */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const q = new URL(req.url).searchParams;
  const target = q.get("u") ?? "";
  const sig = q.get("sig") ?? "";
  if (!target || !sig || !verifyImageUrl(user.id, target, sig)) {
    return new Response("bad signature", { status: 403 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return new Response("bad scheme", { status: 400 });
  }
  try {
    await assertPublicHost(parsed.hostname);
  } catch {
    return new Response("blocked", { status: 403 });
  }

  try {
    const res = await fetch(target, {
      redirect: "manual", // never follow (a redirect could aim at an internal host)
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "TessPortal-ImgProxy/1.0", Accept: "image/*" },
    });
    if (res.status >= 300 && res.status < 400) return new Response("redirect blocked", { status: 403 });
    if (!res.ok) return new Response("upstream error", { status: 502 });
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("image/")) return new Response("not an image", { status: 415 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 10_000_000) return new Response("too large", { status: 413 });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
}
