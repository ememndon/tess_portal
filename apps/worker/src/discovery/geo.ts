/**
 * Location sanity check for providers that cannot scope a search to a country.
 *
 * Jooble is a single global endpoint: the only country signal is the `location`
 * string we send, and nothing in the response says which country a posting is
 * really in. When it has no local matches it quietly falls back to US jobs, so
 * anchoring a posting to the country we asked for labelled Illinois roles "NZ"
 * (and dragged US pay bands into NZ salary bands).
 *
 * This is deliberately conservative: it drops a posting only when the location
 * positively identifies a DIFFERENT country. An unknown city, or no location at
 * all, is kept and stays anchored to the searched country.
 */

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID",
  "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC",
  "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD",
  "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
]);

/** Names a location may carry for each country we search. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  // "northern ireland" is listed first so a Belfast posting resolves to GB and
  // is not mistaken for the Republic of Ireland by the bare "ireland" alias
  GB: ["northern ireland", "united kingdom", "uk", "great britain", "england", "scotland", "wales"],
  IE: ["ireland", "eire"],
  NL: ["netherlands", "holland", "nederland"],
  NZ: ["new zealand", "aotearoa"],
  AU: ["australia"],
  CA: ["canada"],
  NO: ["norway", "norge"],
  AE: ["united arab emirates", "uae"],
  QA: ["qatar"],
  SA: ["saudi arabia"],
  US: ["united states", "usa", "u.s.a."],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (haystack: string, alias: string) =>
  new RegExp(`\\b${escape(alias)}\\b`).test(haystack);

/** True when the location clearly belongs to a country other than `countryCode`. */
export function looksForeign(location: string | null, countryCode: string): boolean {
  if (!location) return false; // no signal — trust the searched country
  const loc = location.toLowerCase();

  // The longest matching alias wins, so "Belfast, Northern Ireland" resolves to
  // GB rather than to IE on the bare "ireland" substring.
  let named: string | null = null;
  let longest = 0;
  for (const [cc, aliases] of Object.entries(COUNTRY_ALIASES)) {
    for (const alias of aliases) {
      if (alias.length > longest && mentions(loc, alias)) {
        longest = alias.length;
        named = cc;
      }
    }
  }
  if (named) return named !== countryCode;

  // "Springfield, IL" — a US state suffix, when we were not searching the US
  if (countryCode !== "US") {
    const suffix = /,\s*([a-z]{2})\s*$/.exec(loc);
    if (suffix && US_STATES.has(suffix[1].toUpperCase())) return true;
  }

  return false; // an unknown city stays with the searched country
}
