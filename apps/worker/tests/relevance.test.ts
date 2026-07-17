import { describe, expect, it } from "vitest";
import { titleRelevance } from "../src/discovery/relevance";

/**
 * The deterministic role-relevance gate. It keeps titles that clearly match
 * the searched role (head noun + coverage), flags synonym/near matches as
 * non-strong (for the embedding rescue), and clearly rejects off-role titles.
 */

describe("titleRelevance", () => {
  it("passes an exact and seniority-prefixed title as strong", () => {
    expect(titleRelevance("Software Engineer", "Software Engineer").strong).toBe(true);
    expect(titleRelevance("Senior Software Engineer", "Software Engineer").strong).toBe(true);
    // Developer is a synonym of Engineer
    expect(titleRelevance("Software Developer", "Software Engineer").strong).toBe(true);
  });

  it("treats a shared head noun but partial coverage as non-strong (rescue candidate)", () => {
    // "Backend Engineer" shares the head noun but not "software" — a real match
    // the embedding rescue should recover, so it must NOT be strong here.
    const backend = titleRelevance("Backend Engineer", "Software Engineer");
    expect(backend.strong).toBe(false);
    expect(backend.headPresent).toBe(true);

    // "Account Manager" vs "Product Manager": head noun present, low coverage —
    // non-strong so it only survives if the embedding agrees (it won't).
    const account = titleRelevance("Account Manager", "Product Manager");
    expect(account.strong).toBe(false);
    expect(account.headPresent).toBe(true);
  });

  it("rejects clearly off-role titles (head noun absent)", () => {
    const support = titleRelevance("IT Support Specialist", "Software Engineer");
    expect(support.strong).toBe(false);
    expect(support.headPresent).toBe(false);

    const warehouse = titleRelevance("Warehouse Operative", "Software Engineer");
    expect(warehouse.headPresent).toBe(false);
    expect(warehouse.coverage).toBe(0);
  });

  it("never blocks when the searched title is empty", () => {
    expect(titleRelevance("Anything At All", "").strong).toBe(true);
  });
});
