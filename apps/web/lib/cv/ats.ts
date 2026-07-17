import { extractText } from "./extract";
import { detectSections, keywordGap } from "@/lib/analysis/nlp";

/**
 * ATS simulation. Re-parses a generated document with the SAME
 * extractors an ATS would use (mammoth, pdfjs), detects the standard
 * sections, scores keyword coverage against the posting, and returns
 * specific, actionable fixes. Applying a fix (adding a missing keyword,
 * a missing section) measurably changes the score.
 */

export type AtsResult = {
  score: number;
  sections: { name: string; present: boolean }[];
  coverage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  fixes: string[];
};

const SECTION_LABELS: { key: keyof ReturnType<typeof detectSections>; label: string }[] = [
  { key: "contact", label: "Contact details" },
  { key: "summary", label: "Summary" },
  { key: "experience", label: "Experience" },
  { key: "education", label: "Education" },
  { key: "skills", label: "Skills" },
];

/** Runs the simulation against generated file bytes (DOCX or PDF). */
export async function simulateAtsFromFile(
  buffer: Buffer,
  mime: string,
  fileName: string,
  jobText: string,
): Promise<AtsResult> {
  const text = await extractText(buffer, mime, fileName);
  return simulateAtsFromText(text, jobText);
}

export function simulateAtsFromText(cvText: string, jobText: string): AtsResult {
  const sections = detectSections(cvText);
  const gap = keywordGap(jobText, cvText);

  const sectionList = SECTION_LABELS.map((s) => ({ name: s.label, present: sections[s.key] }));
  const sectionsPresent = sectionList.filter((s) => s.present).length;
  const sectionScore = sectionsPresent / SECTION_LABELS.length; // 0..1

  // parseability: penalize if the extractor got very little text (e.g. an
  // image-only PDF that an ATS also could not read)
  const parseable = cvText.replace(/\s+/g, " ").trim().length > 200 ? 1 : 0.4;

  const score = Math.max(
    1,
    Math.min(100, Math.round((0.55 * gap.coverage + 0.3 * sectionScore + 0.15 * parseable) * 100)),
  );

  const fixes: string[] = [];
  for (const s of sectionList) {
    if (!s.present) fixes.push(`Add a clear "${s.name}" section, ATS parsers look for it by heading.`);
  }
  if (gap.missing.length > 0) {
    fixes.push(
      `Work these posting keywords into your CV where they are genuinely true: ${gap.missing.slice(0, 10).join(", ")}.`,
    );
  }
  if (parseable < 1) {
    fixes.push("The file extracted very little text. Avoid image-only or heavily columned layouts an ATS cannot read.");
  }
  if (fixes.length === 0) fixes.push("Strong ATS parse. Sections are clear and keyword coverage is high.");

  return {
    score,
    sections: sectionList,
    coverage: gap.coverage,
    matchedKeywords: gap.covered,
    missingKeywords: gap.missing,
    fixes,
  };
}
