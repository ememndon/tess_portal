import { describe, expect, it } from "vitest";
import { slugCandidates, namesMatch } from "../src/discovery/ats-resolve";

/**
 * Board-slug candidates and the hit-verification rule that keeps the
 * sponsor→board resolver from claiming unrelated boards via a short slug.
 */

describe("slugCandidates", () => {
  it("adds a first-word slug only when it is distinctive (>=5 chars)", () => {
    // "Monzo Bank" → the brand first word is trusted
    expect(slugCandidates("Monzo Bank Limited")).toEqual(["monzobanklimited", "monzo"]);
    // "ING Bank" → "ing" (3 chars) is too short to trust, collapsed only
    expect(slugCandidates("ING Bank")).toEqual(["ingbank"]);
    // "Able Healthcare" → "able" (4) dropped, so the greenhouse/able collision is avoided
    expect(slugCandidates("Able Healthcare Ltd")).toEqual(["ablehealthcareltd"]);
  });

  it("handles single-word names and punctuation", () => {
    expect(slugCandidates("Booking.com")).toEqual(["bookingcom", "booking"]);
    expect(slugCandidates("Stripe")).toEqual(["stripe"]);
  });
});

describe("namesMatch", () => {
  it("accepts a board whose name leads the sponsor name", () => {
    expect(namesMatch("Monzo", "Monzo Bank Limited")).toBe(true);
    expect(namesMatch("Deliveroo", "Deliveroo Ireland Ltd")).toBe(true);
  });

  it("rejects the collisions that broke the first run", () => {
    // greenhouse/bw board named "BW" (2 chars) must not claim BW Refrigeration
    expect(namesMatch("BW", "BW Refrigeration & Air Conditioning Limited")).toBe(false);
    // a different "Casa" board must not claim Casa Bamboo
    expect(namesMatch("Casa Systems", "CASA BAMBOO LTD T/a Pho Le")).toBe(false);
    // short 2-char brand can't be verified either way
    expect(namesMatch("2K", "2K Games Dublin Limited")).toBe(false);
  });
});
