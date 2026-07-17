import { runCompletion } from "@/lib/ai/run";
import { profileSchema, type Profile } from "./schema";

/**
 * LLM structuring of extracted CV text into the strict profile schema.
 * The model is told to extract only what the CV states and never to
 * invent. The result is a DRAFT, the user reviews and confirms it
 * before anything downstream trusts it.
 */

const SYSTEM = `You convert a CV into a strict JSON profile. Extract only what the CV actually states. Never invent skills, employers, dates, or achievements. If a field is not present, leave it empty. Reply with ONLY a JSON object, no code fence, no commentary, with exactly these keys:
{
  "name": string,
  "headline": string,          // professional title/headline
  "email": string,
  "phone": string,
  "location": string,
  "links": string[],           // portfolio, LinkedIn, GitHub URLs
  "summary": string,           // professional summary if present
  "skills": string[],          // concrete skills and technologies stated
  "experience": [{ "company": string, "role": string, "location": string, "start": string, "end": string, "current": boolean, "bullets": string[] }],
  "education": [{ "institution": string, "degree": string, "field": string, "start": string, "end": string }],
  "projects": [{ "name": string, "description": string, "url": string, "tech": string[] }],
  "certifications": [{ "name": string, "issuer": string, "year": string }],
  "languages": [{ "name": string, "level": string }],
  "workStyle": string          // leave empty unless the CV explicitly describes working style
}`;

function extractJson(text: string): unknown {
  let t = text.trim();
  // strip a code fence if the model added one
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // grab the outermost object
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

export async function parseCvToProfile(userId: string, cvText: string): Promise<Profile> {
  const result = await runCompletion({
    activity: "cv_parse",
    userId,
    system: SYSTEM,
    prompt: `CV text:\n\n${cvText.slice(0, 24000)}`,
    maxTokens: 4000,
  });
  if (!result) throw new Error("no AI provider is available to parse the CV");
  const raw = extractJson(result.text);
  // strict schema with defaults fills any gaps and drops unexpected keys
  return profileSchema.parse(raw);
}
