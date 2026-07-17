import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-for-signing";
});

describe("cookie signing", () => {
  it("signs and verifies a payload", async () => {
    const { signPayload, verifySigned } = await import("../lib/server/signing");
    const value = signPayload({ v: 3, exp: 1234567890 });
    expect(verifySigned<{ v: number; exp: number }>(value)).toEqual({ v: 3, exp: 1234567890 });
  });

  it("rejects a tampered payload", async () => {
    const { signPayload, verifySigned } = await import("../lib/server/signing");
    const value = signPayload({ v: 3, exp: 1234567890 });
    const [payload, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 99, exp: 9999999999 })).toString("base64url");
    expect(verifySigned(`${forged}.${sig}`)).toBeNull();
    expect(verifySigned(`${payload}.AAAA${sig.slice(4)}`)).toBeNull();
  });

  it("rejects garbage", async () => {
    const { verifySigned } = await import("../lib/server/signing");
    expect(verifySigned(undefined)).toBeNull();
    expect(verifySigned("")).toBeNull();
    expect(verifySigned("no-dot-here")).toBeNull();
  });
});
