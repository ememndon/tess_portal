import dns from "node:dns/promises";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { Agent, fetch } from "undici";

/**
 * SSRF protection for any URL the server fetches on a user's behalf.
 * Blocks non-http(s) schemes and any host that resolves to a private,
 * loopback, link-local, unique-local, CGNAT, IPv4-mapped, or NAT64
 * address. The blocklist is enforced at CONNECTION time via a pinned DNS
 * lookup (safeAgent), so a host cannot pass validation and then rebind
 * to an internal address before the socket opens (no TOCTOU window).
 *
 * NOTE: this classifier is intentionally mirrored in
 * apps/worker/src/intel/fetch.ts — keep the two in sync.
 */

/** Unwrap IPv4-mapped / IPv4-compatible / NAT64 IPv6 forms to their IPv4. */
function unwrapV4(ip: string): string {
  const low = ip.toLowerCase();
  // dotted forms: ::ffff:1.2.3.4 or ::1.2.3.4
  const dotted = low.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted && net.isIPv4(dotted[1])) return dotted[1];
  // hex forms: ::ffff:a9fe:a9fe (mapped) or 64:ff9b::a9fe:a9fe (NAT64)
  const hex = low.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return ip;
}

/** True when the address must not be connected to (SSRF target). */
export function isBlockedAddress(ipRaw: string): boolean {
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
    if (low === "::" || low === "::1") return true; // unspecified, loopback
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local fc00::/7
    if (/^fe[89ab]/.test(low)) return true; // link-local fe80::/10
    return false;
  }
  return true; // not a parseable IP -> unsafe
}

/**
 * DNS lookup for undici that only ever returns a validated public
 * address. undici connects to exactly this address, so the IP that was
 * checked is the IP that is dialed — closing the rebinding window.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns
    .lookup(hostname, { all: true, verbatim: true })
    .then((addrs) => {
      const wantFamily =
        options && typeof options.family === "number" ? options.family : 0;
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

export async function assertSafeUrl(rawUrl: string): Promise<URL> {
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

/**
 * SSRF-checked fetch with a size cap and timeout. Uses undici directly
 * with safeAgent so the connection is pinned to a validated address.
 */
export async function safeFetchText(rawUrl: string, maxBytes = 1_500_000): Promise<string | null> {
  try {
    await assertSafeUrl(rawUrl);
    const res = await fetch(rawUrl, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TessPortal/1.0)" },
      signal: AbortSignal.timeout(12000),
      dispatcher: safeAgent,
    });
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
  } catch {
    return null;
  }
}
