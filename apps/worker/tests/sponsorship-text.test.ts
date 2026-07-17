import { describe, expect, it } from "vitest";
import { mentionsSponsorship, deniesSponsorship } from "../src/discovery/countries";

/**
 * The naive-crawler trap: a posting that says "visa sponsorship is NOT
 * available" must never be counted as a sponsoring role just because the words
 * appear. We err toward not claiming sponsorship.
 */

describe("mentionsSponsorship — positive", () => {
  const yes = [
    "We offer visa sponsorship for the right candidate.",
    "Sponsorship available for exceptional applicants.",
    "The company will sponsor a skilled worker visa.",
    "Relocation package and work permit support provided.",
    "We are able to sponsor visas.",
  ];
  for (const t of yes) it(`counts: ${t}`, () => expect(mentionsSponsorship(t)).toBe(true));
});

describe("mentionsSponsorship — negated must be false", () => {
  const no = [
    "Visa sponsorship is not available for this role.",
    "Unfortunately we are unable to offer visa sponsorship.",
    "No visa sponsorship.",
    "We do not sponsor work visas.",
    "Please note: sponsorship is not offered for this position.",
    "Candidates must already have the right to work in Ireland.",
    "You must hold valid work authorization; no sponsorship provided.",
    "This role does not offer visa sponsorship.",
    "We cannot sponsor at this time.",
    "Applicants must be legally entitled to work without sponsorship.",
  ];
  for (const t of no) {
    it(`rejects: ${t}`, () => {
      expect(mentionsSponsorship(t)).toBe(false);
      expect(deniesSponsorship(t)).toBe(true);
    });
  }
});

describe("mentionsSponsorship — no false denial across clauses", () => {
  it("keeps a positive when a later clause negates something else", () => {
    // sponsorship IS offered; relocation is what's unavailable
    expect(mentionsSponsorship("Visa sponsorship is available; relocation is not available.")).toBe(true);
    expect(deniesSponsorship("Visa sponsorship is available; relocation is not available.")).toBe(false);
  });
  it("does not leak a negation across a sentence boundary", () => {
    expect(mentionsSponsorship("We offer visa sponsorship. This position is not remote.")).toBe(true);
  });
});
