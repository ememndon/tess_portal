import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Phase 7 acceptance in test form. The load-bearing properties: a company
 * brief always carries its sources and never fabricates claims without
 * them; closed-loop insights only surface with an honest sample and stay
 * out of the prompts until they clear a threshold; salary intelligence is
 * grounded in real observations and labels small samples; recommendations
 * exclude already-tracked companies and state their reasons.
 */

type State = {
  aggregates: unknown[];
  profile: Record<string, unknown> | null;
  settings: { targetCountries: { code: string | null }[] };
  samples: unknown[];
  channels: unknown[];
  observations: unknown[];
  completion: { text: string; provider: string; model: string } | null;
  fetch: (url: string) => string | null;
};

const state: State = {
  aggregates: [],
  profile: null,
  settings: { targetCountries: [] },
  samples: [],
  channels: [],
  observations: [],
  completion: null,
  fetch: () => null,
};

vi.mock("@/lib/server/dal", () => ({
  scopeFor: () => ({
    companyAggregates: async () => state.aggregates,
    getConfirmedProfileData: async () => state.profile,
    getSettings: async () => state.settings,
    outcomeSamples: async () => state.samples,
    channelEffectiveness: async () => state.channels,
    salaryObservations: async () => state.observations,
  }),
}));

vi.mock("@/lib/ai/run", () => ({
  runCompletion: async () => state.completion,
  embedText: async () => null,
}));

vi.mock("@/lib/server/ssrf", () => ({
  safeFetchText: async (url: string) => state.fetch(url),
  assertSafeUrl: async (u: string) => new URL(u),
}));

vi.mock("@/lib/server/money", () => {
  const rates = new Map([["EUR", 1], ["USD", 1.1], ["GBP", 0.85]]);
  return {
    loadRates: async () => rates,
    fromEur: (amount: number, currency: string, r: Map<string, number>) => {
      const rate = r.get(currency);
      return rate ? amount * rate : null;
    },
    normalizedAnnualEur: (
      job: { salaryMin: string | null; salaryMax: string | null; salaryCurrency: string | null; salaryPeriod: string | null },
    ) => {
      const min = job.salaryMin === null ? null : Number(job.salaryMin);
      const max = job.salaryMax === null ? null : Number(job.salaryMax);
      const mid = min !== null && max !== null ? (min + max) / 2 : (min ?? max);
      if (mid === null) return null;
      const annual = job.salaryPeriod === "month" ? mid * 12 : mid;
      return annual / (rates.get(job.salaryCurrency ?? "EUR") ?? 1);
    },
  };
});

beforeEach(() => {
  state.aggregates = [];
  state.profile = null;
  state.settings = { targetCountries: [] };
  state.samples = [];
  state.channels = [];
  state.observations = [];
  state.completion = null;
  state.fetch = () => null;
});

describe("company brief", () => {
  it("cites the fetched sources and synthesizes from them", async () => {
    state.fetch = (url) =>
      url.endsWith("/about")
        ? `<html><body>${"Acme builds payment infrastructure and rails in Go and Rust, serving fintechs across Europe. The company reached Series B funding and is scaling its engineering team rapidly across Dublin and Berlin. ".repeat(2)}</body></html>`
        : null;
    state.completion = {
      text: JSON.stringify({
        summary: "Acme builds payment infrastructure.",
        stack: ["Go", "Rust"],
        news: [],
        funding: "Series B",
        talkingPoints: ["Ask about their Go migration"],
      }),
      provider: "test",
      model: "m",
    };
    const { buildCompanyBrief } = await import("../lib/intel/brief");
    const brief = await buildCompanyBrief({ userId: "u", name: "Acme", website: "https://acme.test", sponsorStatus: "confirmed" });
    expect(brief.sources.length).toBeGreaterThan(0);
    expect(brief.sources.some((s) => s.url.includes("/about"))).toBe(true);
    expect(brief.stack).toContain("Go");
    expect(brief.sponsorship).toMatch(/confirmed/i);
    expect(brief.model).toBe("test:m");
  });

  it("makes no claims when nothing is fetchable, and says so", async () => {
    state.fetch = () => null;
    const { buildCompanyBrief } = await import("../lib/intel/brief");
    const brief = await buildCompanyBrief({ userId: "u", name: "Ghost", website: "https://ghost.test", sponsorStatus: "unknown" });
    expect(brief.sources).toHaveLength(0);
    expect(brief.stack).toHaveLength(0);
    expect(brief.talkingPoints).toHaveLength(0);
    expect(brief.note).toBeTruthy();
  });
});

describe("closed-loop learning honesty", () => {
  const sample = (over: Record<string, unknown>) => ({
    jobId: Math.random().toString(),
    stage: "applied",
    source: "greenhouse",
    applied: true,
    hasTailoredCv: false,
    hasCoverLetter: false,
    outreachCount: 0,
    outreachWords: 0,
    reachedInterview: false,
    reachedOffer: false,
    rejected: false,
    ...over,
  });

  it("stays silent in the prompt when the sample is tiny", async () => {
    state.samples = [sample({ hasTailoredCv: true, reachedInterview: true }), sample({})];
    const { learnedPatternsForPrompt } = await import("../lib/intel/insights");
    expect(await learnedPatternsForPrompt("u")).toBe("");
  });

  it("surfaces a labeled insight once the sample is real", async () => {
    const withCv = Array.from({ length: 10 }, (_, i) => sample({ hasTailoredCv: true, reachedInterview: i < 6 }));
    const without = Array.from({ length: 10 }, (_, i) => sample({ hasTailoredCv: false, reachedInterview: i < 1 }));
    state.samples = [...withCv, ...without];
    const { computeInsights, learnedPatternsForPrompt } = await import("../lib/intel/insights");
    const { insights, totalSamples } = await computeInsights("u");
    expect(totalSamples).toBe(20);
    const cvInsight = insights.find((i) => i.statement.includes("Tailored CV"));
    expect(cvInsight).toBeTruthy();
    expect(cvInsight!.confidence).toBe("moderate");
    expect(cvInsight!.actionable).toBe(true);
    expect(cvInsight!.n).toBe(20);
    // and now it is allowed into the prompt, still labeled
    const prompt = await learnedPatternsForPrompt("u");
    expect(prompt).toMatch(/low-confidence/i);
    expect(prompt).toMatch(/n=20/);
  });
});

describe("salary intelligence", () => {
  const obs = (title: string, min: number, max: number, cc = "IE") => ({
    title,
    countryCode: cc,
    market: null,
    salaryMin: String(min),
    salaryMax: String(max),
    salaryCurrency: "EUR",
    salaryPeriod: "year",
  });

  it("aggregates per role and labels confidence by sample size", async () => {
    state.observations = [
      obs("Senior Software Engineer", 80000, 90000),
      obs("Software Engineer", 70000, 80000),
      obs("Staff Software Engineer", 100000, 120000),
      obs("Software Engineer", 72000, 82000),
    ];
    const { salaryBands, roleKey } = await import("../lib/intel/salary");
    expect(roleKey("Senior Software Engineer")).toBe("software engineer");
    const bands = await salaryBands("u");
    const band = bands.find((b) => b.role === "software engineer" && b.market === "IE");
    expect(band).toBeTruthy();
    expect(band!.n).toBe(4);
    expect(band!.confidence).toBe("anecdotal"); // fewer than 5 samples
    expect(band!.median).toBeGreaterThan(0);
    expect(band!.currency).toBe("EUR"); // the market's own currency
  });

  it("reports a market in its dominant currency, converting the minority in", async () => {
    const gbp = (title: string, min: number, max: number) => ({
      ...obs(title, min, max, "GB"),
      salaryCurrency: "GBP",
    });
    // three GBP postings and one USD one: the band must be quoted in GBP
    state.observations = [
      gbp("Software Engineer", 60000, 60000),
      gbp("Software Engineer", 70000, 70000),
      gbp("Software Engineer", 80000, 80000),
      { ...obs("Software Engineer", 110000, 110000, "GB"), salaryCurrency: "USD" },
    ];
    const { salaryBands } = await import("../lib/intel/salary");
    const band = (await salaryBands("u")).find((b) => b.market === "GB");
    expect(band!.currency).toBe("GBP");
    expect(band!.n).toBe(4); // the USD posting is converted in, not dropped
  });

  it("honours a forced reporting currency", async () => {
    state.observations = [obs("Software Engineer", 70000, 70000)]; // EUR
    const { salaryBands } = await import("../lib/intel/salary");
    const [band] = await salaryBands("u", { currency: "USD" });
    expect(band.currency).toBe("USD");
    expect(band.median).toBe(77000); // 70000 EUR at the mocked 1.1 rate
  });

  it("negotiation script anchors on the data and is honest about small samples", async () => {
    state.observations = [obs("Software Engineer", 70000, 80000), obs("Software Engineer", 72000, 82000)];
    state.completion = null; // force the deterministic template
    const { negotiationScript } = await import("../lib/intel/salary");
    const { script, band, source, currency } = await negotiationScript("u", { role: "Software Engineer", market: "IE" });
    expect(source).toBe("template");
    expect(band).toBeTruthy();
    expect(script).toMatch(/anecdotal/i);
    expect(currency).toBe("EUR");
    expect(script).toMatch(/€/);
  });

  it("writes the script in the market's currency, not EUR", async () => {
    state.observations = [
      { ...obs("Software Engineer", 70000, 70000, "GB"), salaryCurrency: "GBP" },
      { ...obs("Software Engineer", 80000, 80000, "GB"), salaryCurrency: "GBP" },
    ];
    state.completion = null;
    const { negotiationScript } = await import("../lib/intel/salary");
    const { script, currency } = await negotiationScript("u", { role: "Software Engineer", market: "GB" });
    expect(currency).toBe("GBP");
    expect(script).toMatch(/£/);
    expect(script).not.toMatch(/€|EUR/);
  });

  it("says it lacks data rather than inventing a rate", async () => {
    state.observations = [];
    const { negotiationScript } = await import("../lib/intel/salary");
    const { script, band } = await negotiationScript("u", { role: "Rocket Surgeon", market: "IE" });
    expect(band).toBeNull();
    expect(script).toMatch(/not.*enough|do not have/i);
  });
});

describe("recommendations", () => {
  it("excludes tracked companies and states reasons", async () => {
    state.profile = { skills: ["react", "typescript"] };
    state.settings = { targetCountries: [{ code: "IE" }] };
    state.aggregates = [
      { companyName: "Tracked Co", countryCode: "IE", roleCount: 3, bestMatch: 80, sponsorship: "confirmed", sampleTitle: "React Engineer", savedCount: 1, tracked: true },
      { companyName: "Fresh Co", countryCode: "IE", roleCount: 2, bestMatch: 75, sponsorship: "confirmed", sampleTitle: "Senior React Engineer", savedCount: 0, tracked: false },
    ];
    const { recommendCompanies } = await import("../lib/intel/recommend");
    const recs = await recommendCompanies("u");
    expect(recs.some((r) => r.companyName === "Tracked Co")).toBe(false);
    const fresh = recs.find((r) => r.companyName === "Fresh Co");
    expect(fresh).toBeTruthy();
    expect(fresh!.reasons.length).toBeGreaterThan(0);
    expect(fresh!.reasons.join(" ")).toMatch(/react|sponsor|target/i);
  });
});
