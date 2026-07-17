import { describe, expect, it, vi } from "vitest";

/**
 * Phase 5 acceptance in test form. The critical property: a tailored CV
 * never contains a claim absent from the confirmed profile, even when
 * the model tries to inject one. Also covers match scoring, the ATS
 * simulation responding to fixes, and profile schema parsing.
 */

// the model is coaxed into injecting a skill the profile does not have;
// the enforcement layer must strip it before anything is generated
vi.mock("@/lib/ai/run", () => ({
  runCompletion: async () => ({
    text: JSON.stringify({
      // COBOL is job-demanded; Python is NOT in the job at all. Both are
      // absent from the profile and must be stripped.
      summary:
        "Seasoned engineer with deep COBOL and mainframe expertise, also an expert in Python. Built scalable systems in TypeScript.",
      experience: [
        {
          company: "Acme",
          role: "Engineer",
          bullets: [
            "Led COBOL migration for a bank.",
            "Wrote extensive Python data pipelines.",
            "Built a TypeScript platform used by thousands.",
          ],
        },
      ],
    }),
    provider: "test",
    model: "test",
  }),
  embedText: async () => null,
}));

const profile = {
  name: "Test Person",
  headline: "Software Engineer",
  email: "t@example.com",
  phone: "",
  location: "Dublin, Ireland",
  links: [],
  summary: "Software engineer focused on TypeScript and Node platforms.",
  skills: ["TypeScript", "Node.js", "PostgreSQL", "Kubernetes"],
  experience: [
    { company: "Acme", role: "Engineer", location: "Dublin", start: "2021", end: "Present", current: true, bullets: ["Built a TypeScript platform used by thousands."] },
  ],
  education: [],
  projects: [{ name: "Platform", description: "A TypeScript platform", url: "", tech: ["TypeScript", "Node.js"] }],
  certifications: [],
  languages: [],
  workStyle: "collaborative and autonomous",
};

const cobolJob =
  "Senior COBOL Developer. We need deep COBOL and mainframe experience, plus JCL and DB2. TypeScript is a plus.";

describe("no unconfirmed claims constraint", () => {
  it("strips both a job-demanded and a job-unrelated injected skill", async () => {
    const { tailorCv, findUnconfirmedClaims } = await import("../lib/cv/tailor");
    const { tailored } = await tailorCv("u1", profile as never, cobolJob);

    const blob = [tailored.summary, tailored.skills.join(" "), tailored.experience.map((e) => e.bullets.join(" ")).join(" ")]
      .join(" ")
      .toLowerCase();
    // COBOL (job-demanded) must be gone
    expect(blob).not.toContain("cobol");
    expect(blob).not.toContain("mainframe");
    // Python (NOT in the job posting, still absent from the profile) must
    // also be gone, this is the stronger invariant
    expect(blob).not.toContain("python");

    // the safety check confirms zero violations
    expect(findUnconfirmedClaims(tailored, profile as never)).toHaveLength(0);

    // the confirmed TypeScript claim survived
    expect(blob).toContain("typescript");
    expect(tailored.removedClaims.length).toBeGreaterThan(0);
  });

  it("tailored skills are always a subset of confirmed skills", async () => {
    const { tailorCv } = await import("../lib/cv/tailor");
    const { tailored } = await tailorCv("u1", profile as never, cobolJob);
    const confirmed = new Set(profile.skills.map((s) => s.toLowerCase()));
    for (const s of tailored.skills) expect(confirmed.has(s.toLowerCase())).toBe(true);
  });

  it("the validator catches a forbidden claim in any field if one slips through", async () => {
    const { findUnconfirmedClaims } = await import("../lib/cv/tailor");
    // an injected skill in a project description, unrelated to the job
    const forged = {
      headline: "",
      summary: "Expert in COBOL.",
      skills: ["TypeScript"],
      experience: [],
      selectedProjects: [{ name: "X", description: "Built with Rust and Go", url: "", tech: ["Rust"] }],
      removedClaims: [],
    };
    const violations = findUnconfirmedClaims(forged as never, profile as never);
    expect(violations).toContain("cobol");
    expect(violations).toContain("rust");
  });

  it("does not false-positive on substrings (java vs javascript)", async () => {
    const { unconfirmedSkillsIn } = await import("../lib/analysis/skills");
    // profile has javascript and typescript; a CV that says "JavaScript"
    // must not be flagged for the absent skill "java"
    const jsProfile = { ...profile, skills: ["JavaScript", "TypeScript"] };
    expect(unconfirmedSkillsIn("Strong JavaScript and TypeScript developer.", jsProfile as never)).toHaveLength(0);
    // but a real "Java" claim (word-bounded) is caught
    expect(unconfirmedSkillsIn("Also skilled in Java.", jsProfile as never)).toContain("java");
  });
});

describe("match scoring", () => {
  it("scores a matching profile higher than a mismatched job", async () => {
    const { matchScore } = await import("../lib/match/score");
    const tsJob = "Senior TypeScript Engineer. Node.js, PostgreSQL, Kubernetes. Build scalable platforms.";
    const good = matchScore({ profile: profile as never, jobText: tsJob, jobEmbedding: null, profileEmbedding: null });
    const bad = matchScore({ profile: profile as never, jobText: "Registered Nurse, ICU ward, patient care.", jobEmbedding: null, profileEmbedding: null });
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.reasons.join(" ")).toMatch(/key terms/i);
  });
});

describe("ATS simulation", () => {
  it("returns fixes, and adding a missing section raises the score", async () => {
    const { simulateAtsFromText } = await import("../lib/cv/ats");
    const job = "TypeScript engineer with Kubernetes and PostgreSQL experience building platforms.";
    const thin = "John Doe. Did some work with computers.";
    const rich =
      "John Doe john@x.com +353 1 234 5678\nSummary: TypeScript engineer.\nExperience: Built platforms with Kubernetes and PostgreSQL.\nEducation: BSc Computer Science.\nSkills: TypeScript, Kubernetes, PostgreSQL, Node.";
    const thinResult = simulateAtsFromText(thin, job);
    const richResult = simulateAtsFromText(rich, job);
    expect(richResult.score).toBeGreaterThan(thinResult.score);
    expect(thinResult.fixes.length).toBeGreaterThan(0);
    expect(thinResult.fixes.join(" ")).toMatch(/section|keyword/i);
  });
});

describe("profile schema", () => {
  it("fills defaults and drops unknown keys", async () => {
    const { profileSchema } = await import("../lib/cv/schema");
    const parsed = profileSchema.parse({ name: "A", skills: ["X"], bogus: 1 });
    expect(parsed.name).toBe("A");
    expect(parsed.skills).toEqual(["X"]);
    expect(parsed.experience).toEqual([]);
    expect("bogus" in parsed).toBe(false);
  });
});
