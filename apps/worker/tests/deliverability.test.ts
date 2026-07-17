import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Phase 8 deliverability parsing. The monitor must not be fooled by a
 * revoked (empty p=) DKIM key, must flag duplicate SPF records as a
 * permerror, and must mark a transient DNS failure inconclusive rather
 * than raising a false alarm.
 */

const state: { txt: Record<string, string[]>; txtErr: Record<string, string>; mx: { exchange: string; priority: number }[]; mxErr?: string } = {
  txt: {},
  txtErr: {},
  mx: [],
};

vi.mock("node:dns/promises", () => ({
  default: {
    resolveMx: async () => {
      if (state.mxErr) throw Object.assign(new Error("mx"), { code: state.mxErr });
      return state.mx;
    },
    resolveTxt: async (name: string) => {
      if (state.txtErr[name]) throw Object.assign(new Error("txt"), { code: state.txtErr[name] });
      const recs = state.txt[name];
      if (!recs) throw Object.assign(new Error("txt"), { code: "ENOTFOUND" });
      return recs.map((r) => [r]);
    },
  },
}));

beforeEach(() => {
  state.txt = {};
  state.txtErr = {};
  state.mx = [{ exchange: "mx1.hostinger.com", priority: 10 }];
  state.mxErr = undefined;
});

const D = "example.test";

describe("deliverability checks", () => {
  it("is healthy with single SPF, DMARC, MX and a live DKIM key", async () => {
    state.txt[D] = ["v=spf1 include:_spf.test ~all"];
    state.txt[`_dmarc.${D}`] = ["v=DMARC1; p=none"];
    state.txt[`hostingermail-a._domainkey.${D}`] = ["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ"];
    const { checkDeliverability } = await import("../src/health/deliverability");
    const r = await checkDeliverability(D);
    expect(r.healthy).toBe(true);
    expect(r.inconclusive).toBe(false);
    expect(r.dkim.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("treats a revoked DKIM key (empty p=) as failing, not healthy", async () => {
    state.txt[D] = ["v=spf1 include:_spf.test ~all"];
    state.txt[`_dmarc.${D}`] = ["v=DMARC1; p=none"];
    state.txt[`hostingermail-a._domainkey.${D}`] = ["v=DKIM1; p="]; // revoked
    const { checkDeliverability } = await import("../src/health/deliverability");
    const r = await checkDeliverability(D);
    expect(r.dkim.ok).toBe(false);
    expect(r.failures).toContain("DKIM");
    expect(r.healthy).toBe(false);
  });

  it("flags duplicate SPF records as a permerror", async () => {
    state.txt[D] = ["v=spf1 include:a ~all", "v=spf1 include:b ~all"];
    state.txt[`_dmarc.${D}`] = ["v=DMARC1; p=none"];
    state.txt[`hostingermail-a._domainkey.${D}`] = ["v=DKIM1; p=MIGfMA0key"];
    const { checkDeliverability } = await import("../src/health/deliverability");
    const r = await checkDeliverability(D);
    expect(r.spf.ok).toBe(false);
    expect(r.spf.detail).toMatch(/permerror|2 v=spf1/i);
    expect(r.failures).toContain("SPF");
  });

  it("marks a transient DNS failure inconclusive rather than failing", async () => {
    state.txtErr[D] = "ESERVFAIL"; // transient
    state.txt[`_dmarc.${D}`] = ["v=DMARC1; p=none"];
    state.txt[`hostingermail-a._domainkey.${D}`] = ["v=DKIM1; p=MIGfkey"];
    const { checkDeliverability } = await import("../src/health/deliverability");
    const r = await checkDeliverability(D);
    expect(r.inconclusive).toBe(true);
  });

  it("a genuinely absent record (ENOTFOUND) is a real failure, not inconclusive", async () => {
    // no txt records at all -> resolveTxt throws ENOTFOUND for every name
    const { checkDeliverability } = await import("../src/health/deliverability");
    const r = await checkDeliverability(D);
    expect(r.inconclusive).toBe(false);
    expect(r.spf.ok).toBe(false);
    expect(r.dkim.ok).toBe(false);
    expect(r.healthy).toBe(false);
  });
});
