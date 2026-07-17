import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, reencryptSecret } from "@tessportal/shared";

const KEY = "a".repeat(64);
const KEY2 = "b".repeat(64);

describe("vault crypto", () => {
  it("round-trips a secret", () => {
    const blob = encryptSecret(KEY, "hunter2-secret-value");
    expect(decryptSecret(KEY, blob)).toBe("hunter2-secret-value");
  });

  it("uses a unique IV per record", () => {
    const a = encryptSecret(KEY, "same-value");
    const b = encryptSecret(KEY, "same-value");
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64").subarray(0, 12)).not.toEqual(
      Buffer.from(b, "base64").subarray(0, 12),
    );
  });

  it("never exposes plaintext in the stored blob", () => {
    const blob = encryptSecret(KEY, "visible-marker-string");
    expect(blob).not.toContain("visible-marker");
    expect(Buffer.from(blob, "base64").toString("utf8")).not.toContain("visible-marker");
  });

  it("rejects tampered ciphertext", () => {
    const blob = encryptSecret(KEY, "value");
    const raw = Buffer.from(blob, "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptSecret(KEY, raw.toString("base64"))).toThrow();
  });

  it("rejects the wrong key", () => {
    const blob = encryptSecret(KEY, "value");
    expect(() => decryptSecret(KEY2, blob)).toThrow();
  });

  it("supports key rotation", () => {
    const blob = encryptSecret(KEY, "rotate-me");
    const rotated = reencryptSecret(KEY, KEY2, blob);
    expect(decryptSecret(KEY2, rotated)).toBe("rotate-me");
    expect(() => decryptSecret(KEY, rotated)).toThrow();
  });
});
