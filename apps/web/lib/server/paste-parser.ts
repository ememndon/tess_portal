import { z } from "zod";

/**
 * Paste-in job parser. Primary path: LLM extraction through the
 * provider router (activity paste_parse, free-first chain). Fallback:
 * the Phase 2 heuristics, so parsing always returns something even
 * with no provider configured.
 */

export type ParsedJob = {
  title: string;
  companyName: string;
  location: string;
  url: string;
  salaryRaw: string;
  description: string;
  parsedBy: "heuristic" | "llm";
};

const URL_RE = /https?:\/\/[^\s)>\]]+/;
const SALARY_RE =
  /(?:[€£$]|EUR|GBP|USD|NZ\$|AU\$|CAD|NOK|AED|QAR|SAR)\s?[\d.,]+\s?(?:k|K)?(?:\s?(?:-|to|–)\s?(?:[€£$])?[\d.,]+\s?(?:k|K)?)?(?:\s?(?:per|\/)\s?(?:year|month|day|hour|annum|yr|mo))?/;
const LOCATION_HINT_RE =
  /(?:location|based in|office in|hybrid in|remote from)[:\s]+([^\n.;]{3,60})/i;

const llmOutput = z.object({
  title: z.string().default(""),
  companyName: z.string().default(""),
  location: z.string().default(""),
  url: z.string().default(""),
  salaryRaw: z.string().default(""),
});

export async function parsePastedJob(text: string): Promise<ParsedJob> {
  try {
    const { runCompletion } = await import("../ai/run");
    const result = await runCompletion({
      activity: "paste_parse",
      userId: null,
      system:
        "You extract structured fields from pasted job postings. Reply with ONLY a JSON object, no code fence, with keys: title, companyName, location, url, salaryRaw. Use empty strings for anything absent. Never invent values.",
      prompt: text.slice(0, 12000),
      maxTokens: 400,
    });
    if (result) {
      const raw = result.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const parsed = llmOutput.parse(JSON.parse(raw));
      if (parsed.title || parsed.companyName) {
        return {
          title: parsed.title.slice(0, 140),
          companyName: parsed.companyName.slice(0, 120),
          location: parsed.location.slice(0, 80),
          url: parsed.url.slice(0, 2000),
          salaryRaw: parsed.salaryRaw.slice(0, 200),
          description: text.slice(0, 50000),
          parsedBy: "llm",
        };
      }
    }
  } catch {
    // fall through to heuristics
  }
  return heuristicParse(text);
}

function heuristicParse(text: string): ParsedJob {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const title = (lines[0] ?? "").slice(0, 140);
  // second line is often "Company · Location" or just the company
  const second = lines[1] ?? "";
  const parts = second.split(/[·|•\-–]/).map((p) => p.trim());
  const companyName = (parts[0] ?? "").slice(0, 120);
  const locationFromSecond = parts.length > 1 ? parts[1].slice(0, 80) : "";
  const locationFromHint = LOCATION_HINT_RE.exec(text)?.[1]?.trim() ?? "";

  return {
    title,
    companyName,
    location: locationFromSecond || locationFromHint,
    url: URL_RE.exec(text)?.[0] ?? "",
    salaryRaw: SALARY_RE.exec(text)?.[0]?.trim() ?? "",
    description: text.slice(0, 50000),
    parsedBy: "heuristic",
  };
}
