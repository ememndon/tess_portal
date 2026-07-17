import { runCompletion } from "@/lib/ai/run";
import { safeFetchText } from "@/lib/server/ssrf";

/**
 * Company research briefs. Tess fetches the company's own site
 * (SSRF-checked), pulls readable text from a few relevant pages, and
 * synthesizes a structured brief through the router. Every brief carries
 * its sources: the exact URLs the text came from. No source, no claim.
 * When no model is available the brief still returns, sourced, with the
 * raw excerpts so the page is never empty.
 */

export type CompanyBrief = {
  summary: string;
  stack: string[];
  news: string[];
  funding: string;
  sponsorship: string;
  talkingPoints: string[];
  sources: { label: string; url: string }[];
  generatedAt: string;
  model: string | null;
  note?: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const BRIEF_SYSTEM = `You write a concise research brief on a company for a job seeker preparing to apply and interview. You are given text scraped from the company's own website, each excerpt labeled with its source URL.

Hard rules:
- Use ONLY what the excerpts support. Do not invent funding rounds, customers, or technologies. If the text does not say, leave the field empty or say "not stated on the site".
- Keep it tight and factual. No marketing tone.

Reply with ONLY JSON, no code fence:
{
  "summary": string,            // 2-3 sentences on what the company does
  "stack": string[],            // technologies named in the text, else []
  "news": string[],             // recent announcements/blog items named, else []
  "funding": string,            // funding or size if stated, else "not stated on the site"
  "talkingPoints": string[]     // 3-5 specific things to mention in an interview, grounded in the text
}`;

export async function buildCompanyBrief(input: {
  userId: string;
  name: string;
  website?: string | null;
  sponsorStatus?: string;
}): Promise<CompanyBrief> {
  const sources: { label: string; url: string }[] = [];
  const excerpts: string[] = [];

  if (input.website) {
    try {
      const base = new URL(input.website);
      const paths = ["", "/about", "/about-us", "/careers", "/jobs", "/blog", "/news", "/engineering"];
      const seen = new Set<string>();
      for (const p of paths) {
        if (excerpts.length >= 5) break;
        const url = new URL(p, base).toString();
        if (seen.has(url)) continue;
        seen.add(url);
        const html = await safeFetchText(url);
        if (!html) continue;
        const text = stripHtml(html).slice(0, 4000);
        if (text.length < 120) continue;
        sources.push({ label: p === "" ? "Homepage" : p.replace(/^\//, ""), url });
        excerpts.push(`Source: ${url}\n${text}`);
      }
    } catch {
      // bad website, brief will note the lack of sources
    }
  }

  const sponsorship =
    input.sponsorStatus === "confirmed"
      ? "On the official sponsor register (confirmed)."
      : input.sponsorStatus === "inferred"
        ? "Sponsorship inferred, not confirmed on a register."
        : "Sponsorship status unknown.";

  if (excerpts.length === 0) {
    return {
      summary: input.website
        ? "Could not read the company site. Add a working website URL to generate a sourced brief."
        : "No website on file. Add one so Tess can fetch and cite real sources.",
      stack: [],
      news: [],
      funding: "not stated on the site",
      sponsorship,
      talkingPoints: [],
      sources,
      generatedAt: new Date().toISOString(),
      model: null,
      note: "No readable source pages were fetched, so this brief has no company claims.",
    };
  }

  const prompt = `Company: ${input.name}\n\nExcerpts from the company website:\n\n${excerpts.join("\n\n---\n\n")}`;
  const completion = await runCompletion({
    activity: "company_brief",
    userId: input.userId,
    system: BRIEF_SYSTEM,
    prompt,
    maxTokens: 1200,
  }).catch(() => null);

  let parsed: Partial<CompanyBrief> = {};
  if (completion?.text) {
    try {
      const cleaned = completion.text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned) as Partial<CompanyBrief>;
    } catch {
      parsed = {};
    }
  }

  return {
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : `Brief for ${input.name}. See sources below.`,
    stack: Array.isArray(parsed.stack) ? parsed.stack.slice(0, 20).map(String) : [],
    news: Array.isArray(parsed.news) ? parsed.news.slice(0, 8).map(String) : [],
    funding: typeof parsed.funding === "string" ? parsed.funding : "not stated on the site",
    sponsorship,
    talkingPoints: Array.isArray(parsed.talkingPoints) ? parsed.talkingPoints.slice(0, 6).map(String) : [],
    sources,
    generatedAt: new Date().toISOString(),
    model: completion ? `${completion.provider}:${completion.model}` : null,
    note: completion ? undefined : "Model unavailable; brief lists the sources fetched without synthesis.",
  };
}
