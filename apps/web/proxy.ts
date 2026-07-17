import { NextRequest, NextResponse } from "next/server";

/**
 * Edge pre-filter. Verifies cookie signatures and expiry cheaply so
 * unauthenticated traffic never reaches app pages. The authoritative
 * checks (server-side session record, gate version) run in the server
 * layer on every request.
 */

const PUBLIC_PREFIXES = [
  "/gate",
  "/login",
  "/invite",
  "/r",
  "/case-study",
  "/api/auth",
  "/api/health",
  "/api/calendar/ics",
  "/robots.txt",
  "/icon.png",
  "/apple-icon.png",
];

/**
 * Builds a strict, per-request Content-Security-Policy. Scripts are
 * allowed only from this origin or carrying the request nonce, so there
 * is no 'unsafe-inline' or 'unsafe-eval' for scripts. Next.js reads the
 * nonce from the CSP on the request headers and stamps it onto its own
 * scripts. Everything the app loads is same-origin and self-hosted.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // same-origin srcdoc frame renders sanitized email safely (sandbox has no allow-scripts)
    "frame-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64Url(value: string): string | null {
  try {
    return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

async function verifySigned(value: string | undefined, secret: string): Promise<unknown | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const encoded = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const sigBin = fromBase64Url(sig);
  if (sigBin === null) return null;
  const sigBytes = Uint8Array.from(sigBin, (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // crypto.subtle.verify compares the MAC in constant time
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(encoded));
  if (!ok) return null;
  const decoded = fromBase64Url(encoded);
  if (decoded === null) return null;
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // one nonce per request; forwarded on the request so Next stamps its
  // scripts, and set on every response we return
  const nonce = makeNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const pass = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("content-security-policy", csp);
    return res;
  };
  const withCsp = (res: NextResponse) => {
    res.headers.set("content-security-policy", csp);
    return res;
  };

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return pass();
  }

  const secret = process.env.SESSION_SECRET ?? "";
  const now = Date.now() / 1000;

  const gate = (await verifySigned(req.cookies.get("tp_gate")?.value, secret)) as
    | { exp: number }
    | null;
  if (!gate || gate.exp < now) {
    if (pathname.startsWith("/api/")) {
      return withCsp(NextResponse.json({ error: "gate required" }, { status: 401 }));
    }
    const url = req.nextUrl.clone();
    url.pathname = "/gate";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return withCsp(NextResponse.redirect(url));
  }

  const session = (await verifySigned(req.cookies.get("tp_session")?.value, secret)) as
    | { exp: number }
    | null;
  if (!session || session.exp < now) {
    if (pathname.startsWith("/api/")) {
      return withCsp(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return withCsp(NextResponse.redirect(url));
  }

  return pass();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
