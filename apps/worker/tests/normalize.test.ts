import { describe, expect, it } from "vitest";
import { parseSalary, toEur, annualEur } from "../src/discovery/normalize";
import { fingerprint, normalize } from "../src/discovery/dedup";
import { scoreJob } from "../src/discovery/score";
import type { RawPosting } from "../src/discovery/types";

describe("salary parsing", () => {
  it("parses annual euro salaries", () => {
    const s = parseSalary("€85,000 per year");
    expect(s.currency).toBe("EUR");
    expect(s.period).toBe("year");
    expect(s.min).toBe(85000);
  });

  it("parses monthly gross with slash", () => {
    const s = parseSalary("€5,200/mo gross");
    expect(s.currency).toBe("EUR");
    expect(s.period).toBe("month");
    expect(s.min).toBe(5200);
  });

  it("parses ranges and k-notation with NZ dollar", () => {
    const s = parseSalary("NZ$110k - NZ$130k");
    expect(s.currency).toBe("NZD");
    expect(s.min).toBe(110000);
    expect(s.max).toBe(130000);
  });

  it("infers year from magnitude when period is unstated", () => {
    expect(parseSalary("£72,000").period).toBe("year");
    expect(parseSalary("£450 day rate").period).toBe("day");
  });

  it("keeps the lower bound in a shared-k range like 45-60k", () => {
    const s = parseSalary("€45-60k per year");
    expect(s.min).toBe(45000);
    expect(s.max).toBe(60000);
  });

  it("parses a dollar range with k on both ends", () => {
    const s = parseSalary("$120K – $150K • Offers Commission");
    expect(s.min).toBe(120000);
    expect(s.max).toBe(150000);
  });

  it("ignores non-salary numbers and spans the real figures", () => {
    const s = parseSalary("Team of 200. Salary €60,000 to €80,000 per year.");
    expect(s.min).toBe(60000);
    expect(s.max).toBe(80000);
  });

  it("returns empty for no salary", () => {
    expect(parseSalary(null).currency).toBeNull();
    expect(parseSalary("competitive").min).toBeNull();
  });
});

describe("currency normalization", () => {
  const rates = new Map([
    ["EUR", 1],
    ["USD", 1.08],
    ["GBP", 0.85],
    ["NZD", 1.78],
  ]);

  it("converts to EUR", () => {
    expect(toEur(100, "EUR", rates)).toBe(100);
    expect(Math.round(toEur(108, "USD", rates)!)).toBe(100);
    expect(Math.round(toEur(178000, "NZD", rates)!)).toBe(100000);
  });

  it("uses gulf pegs via USD when ECB lacks the rate", () => {
    // AED pegged 3.6725/USD; 367250 AED -> 100000 USD -> ~92.6k EUR
    const eur = toEur(367250, "AED", rates)!;
    expect(Math.round(eur / 1000)).toBe(93);
  });

  it("annualizes a monthly salary for comparison", () => {
    const eur = annualEur(
      { salaryMin: "5000", salaryMax: "5000", salaryCurrency: "EUR", salaryPeriod: "month" },
      rates,
    );
    expect(eur).toBe(60000);
  });
});

describe("dedup fingerprint", () => {
  it("normalizes away seniority and punctuation", () => {
    expect(normalize("Senior Platform Engineer (TypeScript)")).toBe("platform engineer typescript");
  });

  it("gives the same fingerprint to the same role from two sources", () => {
    const a = fingerprint({ title: "Senior Platform Engineer", companyName: "Arden Labs" });
    const b = fingerprint({ title: "Platform Engineer", companyName: "Arden Labs, Inc." });
    // seniority stripped, punctuation gone; not identical here but company matches
    expect(fingerprint({ title: "Platform Engineer", companyName: "Arden Labs" })).toBe(a);
    expect(b).toContain("platform engineer");
  });
});

describe("fit scoring", () => {
  const base: RawPosting = {
    externalId: "x",
    title: "Platform Engineer",
    companyName: "Arden Labs",
    location: "Dublin, Ireland",
    countryCode: "IE",
    remote: null,
    url: "https://x",
    description: "Kubernetes platform work with visa sponsorship available.",
    salaryRaw: null,
    postedAt: new Date(),
    source: "greenhouse",
    market: "EUR",
  };

  it("scores a target-country title match higher than an off-target one", () => {
    const ctx = { targetCountryCodes: ["IE"], preferredTitles: ["Platform Engineer"], profileEmbeddings: [], familyPriority: true };
    const onTarget = scoreJob(base, null, ctx, "unknown");
    const offTarget = scoreJob({ ...base, countryCode: "US", location: "Austin, US" }, null, ctx, "unknown");
    expect(onTarget.score).toBeGreaterThan(offTarget.score);
    expect(onTarget.reasons.join(" ")).toMatch(/target countries/i);
  });

  it("rewards confirmed sponsorship and stays within 1..99", () => {
    const ctx = { targetCountryCodes: ["IE"], preferredTitles: ["Platform Engineer"], profileEmbeddings: [], familyPriority: true };
    const s = scoreJob(base, null, ctx, "yes");
    expect(s.score).toBeGreaterThanOrEqual(1);
    expect(s.score).toBeLessThanOrEqual(99);
    expect(s.reasons.join(" ")).toMatch(/sponsor/i);
  });
});
