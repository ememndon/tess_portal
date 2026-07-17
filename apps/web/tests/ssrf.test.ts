import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "@/lib/server/ssrf";

/**
 * SSRF address classifier. It must reject private, loopback, link-local,
 * unique-local, CGNAT, and — the fix this test locks in — IPv4-mapped and
 * NAT64 IPv6 forms that embed a private/metadata IPv4, while still allowing
 * ordinary public addresses.
 */

describe("isBlockedAddress", () => {
  it("blocks private/loopback/link-local/CGNAT IPv4", () => {
    for (const ip of [
      "0.0.0.0",
      "127.0.0.1",
      "10.0.0.5",
      "172.16.9.9",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "224.0.0.1",
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("blocks loopback/unique-local/link-local IPv6", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12::3", "fe80::1", "feab::9"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("blocks IPv4-mapped and NAT64 IPv6 embedding private/metadata IPv4 (the bypass)", () => {
    for (const ip of [
      "::ffff:169.254.169.254", // dotted mapped -> metadata
      "::ffff:127.0.0.1", // dotted mapped -> loopback
      "::ffff:10.0.0.5", // dotted mapped -> private
      "::ffff:a9fe:a9fe", // hex mapped -> 169.254.169.254
      "64:ff9b::a9fe:a9fe", // NAT64 -> 169.254.169.254
      "::127.0.0.1", // IPv4-compatible -> loopback
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it("treats an unparseable address as unsafe", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});
