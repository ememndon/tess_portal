import { safeFetchText } from "./ssrf";

/**
 * The guided hiring-manager finder. Tess suggests likely people and
 * where to look, with sources. It never auto-adds a contact: the user
 * confirms or corrects each suggestion. When a company website is
 * given, its team and about pages are fetched (SSRF-checked) and any
 * hiring-relevant person is surfaced with the source URL. Search links
 * are always provided so the user can go further.
 */

export type ContactSuggestion = {
  name: string;
  role: string;
  source: string;
  confidence: "found_on_site" | "search_lead";
};

const TITLE_HINT =
  /(engineering manager|head of engineering|vp engineering|cto|director of engineering|talent|recruit|people|hiring|team lead|technical lead|founder|ceo|hr)/i;

function extractPeople(html: string, sourceUrl: string): ContactSuggestion[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const out: ContactSuggestion[] = [];

  // JSON-LD Person entries
  for (const m of text.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of arr) {
        if (node["@type"] === "Person" && node.name) {
          out.push({ name: String(node.name).slice(0, 80), role: String(node.jobTitle ?? "").slice(0, 80), source: sourceUrl, confidence: "found_on_site" });
        }
      }
    } catch {
      // not valid JSON-LD
    }
  }

  // "Name — Title" or "Name, Title" patterns near hiring-relevant titles
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const re = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*[,—–-]\s*([A-Za-z ,&]{3,50})/g;
  for (const m of plain.matchAll(re)) {
    const role = m[2].trim();
    if (TITLE_HINT.test(role)) {
      out.push({ name: m[1].trim(), role: role.slice(0, 60), source: sourceUrl, confidence: "found_on_site" });
    }
  }

  // dedupe by name
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = p.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function findHiringContacts(company: string, website?: string | null): Promise<{
  suggestions: ContactSuggestion[];
  searchLinks: { label: string; url: string }[];
}> {
  const q = encodeURIComponent(company);
  const searchLinks = [
    { label: "LinkedIn: engineering managers", url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent("engineering manager " + company)}` },
    { label: "LinkedIn: recruiters", url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent("recruiter " + company)}` },
    { label: "Google: team page", url: `https://www.google.com/search?q=${q}+team+OR+leadership+OR+%22our+people%22` },
  ];

  const suggestions: ContactSuggestion[] = [];
  if (website) {
    try {
      const base = new URL(website);
      const candidates = ["", "/about", "/team", "/people", "/company", "/leadership", "/about-us", "/our-team"].map(
        (p) => new URL(p, base).toString(),
      );
      for (const url of candidates.slice(0, 6)) {
        const html = await safeFetchText(url);
        if (html) {
          suggestions.push(...extractPeople(html, url));
          if (suggestions.length >= 8) break;
        }
      }
    } catch {
      // bad website, fall back to search links only
    }
  }

  // add generic search leads if we found nobody
  if (suggestions.length === 0) {
    suggestions.push(
      { name: "Look for the Engineering Manager", role: "Engineering Manager", source: searchLinks[0].url, confidence: "search_lead" },
      { name: "Look for a Talent or Recruiting lead", role: "Recruiter", source: searchLinks[1].url, confidence: "search_lead" },
    );
  }

  return { suggestions: suggestions.slice(0, 10), searchLinks };
}
