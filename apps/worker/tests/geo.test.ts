import { describe, expect, it } from "vitest";
import { looksForeign } from "../src/discovery/geo";

/**
 * The guard that stops a country-blind provider (Jooble) from labelling US
 * postings as New Zealand ones. It must drop only positively-foreign
 * locations, never a legitimate local city it happens not to recognise.
 */

describe("looksForeign", () => {
  it("drops the US locations Jooble actually returned for a New Zealand search", () => {
    expect(looksForeign("Springfield, IL", "NZ")).toBe(true);
    expect(looksForeign("Pawnee, IL", "NZ")).toBe(true);
  });

  it("keeps postings that name the searched country", () => {
    expect(looksForeign("New Zealand", "NZ")).toBe(false);
    expect(looksForeign("United Kingdom", "GB")).toBe(false);
    expect(looksForeign("London, UK", "GB")).toBe(false);
    expect(looksForeign("Ireland", "IE")).toBe(false);
    expect(looksForeign("Amsterdam, NL", "NL")).toBe(false);
  });

  it("keeps an unrecognised local city rather than guessing", () => {
    // conservative: no country signal at all means trust the searched country
    expect(looksForeign("Auckland", "NZ")).toBe(false);
    expect(looksForeign("Knutsford", "GB")).toBe(false);
    expect(looksForeign(null, "NZ")).toBe(false);
    expect(looksForeign("Remote", "NZ")).toBe(false);
  });

  it("drops a posting that names a different country outright", () => {
    expect(looksForeign("Dublin, Ireland", "GB")).toBe(true);
    expect(looksForeign("Toronto, Canada", "NZ")).toBe(true);
    expect(looksForeign("Austin, United States", "GB")).toBe(true);
  });

  it("does not mistake a non-US two-letter suffix for a US state", () => {
    expect(looksForeign("Bath, GB", "GB")).toBe(false);
    expect(looksForeign("Den Haag, NL", "NL")).toBe(false);
  });

  it("leaves US searches alone", () => {
    expect(looksForeign("Springfield, IL", "US")).toBe(false);
  });

  it("reads Northern Ireland as the UK, not the Republic", () => {
    // the longest matching alias wins, so the bare "ireland" substring loses
    expect(looksForeign("Belfast, Northern Ireland", "GB")).toBe(false);
    expect(looksForeign("Belfast, Northern Ireland", "IE")).toBe(true);
  });
});
