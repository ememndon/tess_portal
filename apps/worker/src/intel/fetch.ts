import dns from "node:dns/promises";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { Agent, fetch } from "undici";

/**
 * Size-capped, SSRF-safe text fetch for the worker's intelligence tasks.
 * The URLs it reads include user-controlled company websites, so it
 * enforces the same protection the web side does: only http(s); the host
 * must not resolve to a private, loopback, link-local, unique-local,
 * CGNAT, IPv4-mapped, or NAT64 address; the connection is pinned to a
 * validated address (no DNS-rebinding window); and redirects are followed
 * manually with each hop re-validated.
 *
 * NOTE: the classifier below is mirrored in
 * apps/web/lib/server/ssrf.ts — keep the two in sync.
 */

/** Unwrap IPv4-mapped / IPv4-compatible / NAT64 IPv6 forms to their IPv4. */
function unwrapV4(ip: string): string {
  const low = ip.toLowerCase();
  const dotted = low.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted && net.isIPv4(dotted[1])) return dotted[1];
  const hex = low.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return ip;
}

function isBlockedAddress(ipRaw: string): boolean {
  const ip = unwrapV4(ipRaw);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::" || low === "::1") return true;
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local
    if (/^fe[89ab]/.test(low)) return true; // link-local fe80::/10
    return false;
  }
  return true;
}

/** DNS lookup that only returns a validated public address, pinning the socket to it. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns
    .lookup(hostname, { all: true, verbatim: true })
    .then((addrs) => {
      const wantFamily = options && typeof options.family === "number" ? options.family : 0;
      const safe = addrs.find(
        (a) => !isBlockedAddress(a.address) && (!wantFamily || a.family === wantFamily),
      );
      if (!safe) {
        callback(new Error("blocked address") as NodeJS.ErrnoException, "", 0);
        return;
      }
      callback(null, safe.address, safe.family);
    })
    .catch((e) => callback(e as NodeJS.ErrnoException, "", 0));
};

const safeAgent = new Agent({ connect: { lookup: safeLookup } });

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http and https are allowed");
  if (net.isIP(url.hostname) && isBlockedAddress(url.hostname)) throw new Error("blocked address");
  const resolved = await dns.lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (resolved.length === 0) throw new Error("host does not resolve");
  for (const r of resolved) {
    if (isBlockedAddress(r.address)) throw new Error("blocked address");
  }
  return url;
}

export async function fetchTextCapped(url: string, maxBytes = 1_500_000, timeoutMs = 15000): Promise<string | null> {
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      await assertSafeUrl(current);
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TessPortal/1.0)" },
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher: safeAgent,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        current = new URL(loc, current).toString();
        continue; // re-validated at the top of the next iteration
      }
      if (!res.ok) return null;
      const reader = res.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    }
    return null; // too many redirects
  } catch {
    return null;
  }
}

/** Strips HTML to readable text and collapses whitespace. */
export function readableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
