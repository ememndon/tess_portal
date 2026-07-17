/** Country name and code inference for location strings. */

const NAME_TO_CODE: [RegExp, string][] = [
  // launch countries first
  [/\b(ireland|éire|dublin|cork|galway|limerick)\b/i, "IE"],
  [/\b(netherlands|nederland|holland|amsterdam|rotterdam|utrecht|eindhoven|the hague|den haag)\b/i, "NL"],
  [/\b(new zealand|aotearoa|auckland|wellington|christchurch)\b/i, "NZ"],
  [/\b(norway|norge|oslo|bergen|stavanger|trondheim)\b/i, "NO"],
  [/\b(canada|toronto|vancouver|montreal|calgary|ottawa)\b/i, "CA"],
  [/\b(united kingdom|uk|england|scotland|wales|london|manchester|edinburgh|aberdeen|glasgow)\b/i, "GB"],
  [/\b(australia|sydney|melbourne|brisbane|perth|adelaide)\b/i, "AU"],
  [/\b(united arab emirates|uae|dubai|abu dhabi|sharjah)\b/i, "AE"],
  [/\b(qatar|doha)\b/i, "QA"],
  [/\b(saudi arabia|ksa|riyadh|jeddah|dammam|dhahran|al khobar)\b/i, "SA"],
  // common remote-worker location prefixes, so a country-pinned remote
  // role is tagged and filtered out of a different country's sources.
  // Region and global remotes stay null and remain relevant.
  [/\b(united states|u\.?s\.?a?\.?|usa)\b|^us[:,\s]|,\s*us\b/i, "US"],
  [/\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt)\b/i, "DE"],
  [/\b(france|paris|lyon|toulouse)\b/i, "FR"],
  [/\b(spain|españa|madrid|barcelona)\b/i, "ES"],
  [/\b(india|bengaluru|bangalore|mumbai|hyderabad|pune|gurgaon|noida)\b/i, "IN"],
  [/\b(singapore)\b/i, "SG"],
  [/\b(poland|polska|warsaw|kraków|krakow|wrocław|wroclaw)\b/i, "PL"],
  [/\b(brazil|brasil|são paulo|sao paulo)\b/i, "BR"],
  [/\b(japan|tokyo)\b/i, "JP"],
  [/\b(philippines|manila)\b/i, "PH"],
];

const MARKET: Record<string, string> = {
  IE: "EUR",
  NL: "EUR",
  NZ: "NZD",
  NO: "NOK",
  CA: "CAD",
  GB: "GBP",
  AU: "AUD",
  AE: "AED",
  QA: "QAR",
  SA: "SAR",
};

export function inferCountry(location: string | null | undefined): string | null {
  if (!location) return null;
  for (const [re, code] of NAME_TO_CODE) if (re.test(location)) return code;
  return null;
}

export function isRemote(location: string | null | undefined, text?: string): string | null {
  const hay = `${location ?? ""} ${text ?? ""}`;
  if (/\b(fully remote|100% remote|remote-first|work from home)\b/i.test(hay)) return "remote";
  if (/\bhybrid\b/i.test(hay)) return "hybrid";
  if (/\bremote\b/i.test(hay)) return "remote";
  return null;
}

export function marketFor(countryCode: string | null): string | null {
  return countryCode ? MARKET[countryCode] ?? null : null;
}

/* ---------- sponsorship + family reunification ---------- */

/**
 * Countries that publish an official register of employers licensed to
 * sponsor a work visa. For these, "on the register" is confirmed
 * sponsorship and a posting with no register match and no explicit
 * sponsorship wording is treated as unverified.
 */
export const REGISTER_COUNTRIES = new Set(["GB", "NL", "CA", "NZ", "IE"]);

/**
 * Gulf states run the kafala system: an expatriate's residence and work
 * permit is sponsored by the employer by law, so a role offered to a
 * foreigner there is effectively sponsored. No public register exists,
 * so these never get gated on register/text evidence.
 */
export const GULF_COUNTRIES = new Set(["AE", "QA", "SA"]);

export function isRegisterCountry(code: string | null): boolean {
  return !!code && REGISTER_COUNTRIES.has(code);
}

export function isGulf(code: string | null): boolean {
  return !!code && GULF_COUNTRIES.has(code);
}

/** Plain-text sponsorship signals in a posting body. Central definition. */
const SPONSORSHIP_TEXT =
  /\b(visa sponsorship|sponsor(?:ship)?|work permit|relocation package|skilled worker visa|tier 2|critical skills|highly skilled migrant|will sponsor|able to sponsor)\b/i;

/**
 * Explicit statements that the employer will NOT sponsor. Checked FIRST so a
 * posting that says "visa sponsorship is not available" is never counted as a
 * sponsoring role just because the words "visa sponsorship" appear — the naive
 * crawler failure mode. We err toward NOT claiming sponsorship (a false
 * "sponsors" wastes the seeker's time; a false "no" only hides one posting).
 * Gaps use [^.!?\n] so a negation never leaks across a sentence boundary.
 */
const NO_SPONSORSHIP_PATTERNS: RegExp[] = [
  // negation before the sponsorship term: "no visa sponsorship", "unable to sponsor", "cannot sponsor", "do not offer sponsorship"
  /\b(no|not|without|cannot|can['’]?t|won['’]?t|will not|do(?:es)?\s+not|un(?:able|willing)\s+to|not\s+able\s+to|not\s+in\s+a\s+position\s+to)\b[^.!?;:\n]{0,40}\b(sponsor(?:ship|ing|ed)?|visa|work\s+permit)\b/i,
  // sponsorship term then a negation: "sponsorship is not available/offered/provided", "visa sponsorship unavailable"
  /\b(sponsor(?:ship)?|visa(?:\s+sponsorship)?|work\s+permit)\b[^.!?;:\n]{0,40}\b(not\s+(?:available|offered|provided|possible|an\s+option|considered|supported)|unavailable)\b/i,
  // right-to-work requirements = candidate must already be authorised (no sponsorship)
  /\b(without\s+(?:the\s+need\s+for\s+)?(?:visa\s+)?sponsorship|no\s+sponsorship\b|must\s+(?:already\s+)?(?:have|hold|possess|be)\b[^.!?;:\n]{0,25}\b(?:right\s+to\s+work|work\s+authoriz\w*|work\s+permit|legally\s+(?:able|authoriz\w*|entitled)\s+to\s+work))/i,
];

/** True only when a posting positively signals sponsorship AND does not explicitly deny it. */
export function mentionsSponsorship(text: string | null | undefined): boolean {
  if (!text) return false;
  if (NO_SPONSORSHIP_PATTERNS.some((re) => re.test(text))) return false;
  return SPONSORSHIP_TEXT.test(text);
}

/** True when a posting explicitly states sponsorship is NOT available (used to hard-exclude). */
export function deniesSponsorship(text: string | null | undefined): boolean {
  return !!text && NO_SPONSORSHIP_PATTERNS.some((re) => re.test(text));
}

/**
 * Family-reunification stance per country. A country-level fact, not a
 * per-job one: whether a work-visa holder can bring a spouse and
 * dependents. "income-gated" and "limited" mean it is allowed only
 * above a salary/profession threshold.
 */
export type FamilyStance = "yes" | "income-gated" | "limited" | "unknown";

const FAMILY_REUNIFICATION: Record<string, FamilyStance> = {
  IE: "yes",
  NL: "yes",
  NO: "yes",
  CA: "yes",
  GB: "yes",
  AU: "yes",
  NZ: "income-gated",
  AE: "limited",
  QA: "limited",
  SA: "limited",
};

export function familyReunificationFor(code: string | null): FamilyStance {
  return code ? FAMILY_REUNIFICATION[code] ?? "unknown" : "unknown";
}

/**
 * Approximate monthly income floors (in the local currency of MARKET)
 * above which the Gulf states allow a worker to sponsor family. Used to
 * grant family credit to a Gulf role only when its salary clears the bar.
 */
export const FAMILY_INCOME_FLOOR_MONTHLY: Record<string, number> = {
  AE: 4000, // AED/month (roughly the family-sponsorship threshold)
  QA: 10000, // QAR/month
  SA: 4000, // SAR/month (varies by profession)
};
