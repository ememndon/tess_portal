import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard for user-supplied mail-server hosts. The mailbox connect
 * flow opens real IMAP/SMTP connections to whatever host the user types;
 * without this, an authenticated user could point it at internal
 * addresses (127.0.0.1, 10.x, 169.254.169.254 …) to probe the private
 * network. We resolve the host and reject any private/loopback/
 * link-local/metadata address before connecting.
 */

function ipIsPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
    if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
    if (mapped) return ipIsPrivate(mapped[1]);
    return false;
  }
  return true; // unparseable → unsafe
}

/** Throws if the host resolves to a private/loopback/link-local address. */
export async function assertPublicHost(host: string): Promise<void> {
  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new Error("private address not allowed");
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("could not resolve host");
  }
  if (addrs.length === 0) throw new Error("could not resolve host");
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) throw new Error("private address not allowed");
  }
}
