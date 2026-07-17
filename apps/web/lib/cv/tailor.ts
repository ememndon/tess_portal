import { runCompletion } from "@/lib/ai/run";
import { extractKeywords } from "@/lib/analysis/nlp";
import { stripUnconfirmed, unconfirmedSkillsIn } from "@/lib/analysis/skills";
import { learnedPatternsForPrompt } from "@/lib/intel/insights";
import type { Profile, ProfileProject } from "./schema";

/**
 * The tailoring engine. It re-focuses the confirmed profile for one job
 * under a hard constraint: a tailored CV may only contain claims present
 * in the confirmed profile. Skills are a strict subset of the confirmed
 * set by construction, and every free-text field passes through a
 * validator that strips any job-demanded skill the profile does not
 * back. The result carries a diff against the base variant.
 */

export type TailoredCv = {
  headline: string;
  summary: string;
  skills: string[];
  experience: { company: string; role: string; location: string; start: string; end: string; bullets: string[] }[];
  selectedProjects: ProfileProject[];
  removedClaims: string[]; // claims the constraint stripped, for transparency
};

export type TailorDiff = {
  skillsAdded: string[]; // emphasized (still from confirmed set)
  skillsDropped: string[]; // de-emphasized for this role
  summaryChanged: boolean;
};

const TAILOR_SYSTEM = `You tailor a CV for a specific job. You are given the candidate's CONFIRMED profile and the job. Rewrite the summary and select and rephrase existing experience bullets to emphasize what is most relevant to the job.

Hard rules:
- Use ONLY facts, skills, tools, and achievements that appear in the confirmed profile. Never introduce a skill, technology, employer, or claim that is not already there, even if the job asks for it.
- Do not invent numbers or outcomes.
- Rephrasing and reordering are fine. Fabrication is not.

Reply with ONLY JSON, no code fence:
{ "summary": string, "experience": [{ "company": string, "role": string, "bullets": string[] }] }`;

/** Orders confirmed skills by relevance to the job. Never adds skills. */
function orderSkills(profile: Profile, jobText: string): { ordered: string[]; emphasized: string[]; deemphasized: string[] } {
  const jobKeywords = new Set(extractKeywords(jobText, 45).map((k) => k.toLowerCase()));
  const relevant: string[] = [];
  const rest: string[] = [];
  for (const skill of profile.skills) {
    if (jobKeywords.has(skill.toLowerCase())) relevant.push(skill);
    else rest.push(skill);
  }
  return { ordered: [...relevant, ...rest], emphasized: relevant, deemphasized: rest };
}

export async function tailorCv(
  userId: string,
  profile: Profile,
  jobText: string,
): Promise<{ tailored: TailoredCv; diff: TailorDiff; forbidden: string[] }> {
  const { ordered, emphasized, deemphasized } = orderSkills(profile, jobText);
  const removedClaims: string[] = [];

  // LLM rephrase, constrained. Closed-loop patterns from the user's own
  // history ride in as low-confidence hints, never as license to fabricate.
  let llmSummary = profile.summary;
  let llmExperience = profile.experience.map((e) => ({ company: e.company, role: e.role, bullets: e.bullets }));
  const patterns = await learnedPatternsForPrompt(userId).catch(() => "");
  const result = await runCompletion({
    activity: "cv_tailoring",
    userId,
    system: patterns ? `${TAILOR_SYSTEM}\n\n${patterns}` : TAILOR_SYSTEM,
    prompt: `Confirmed profile:\n${JSON.stringify(
      { headline: profile.headline, summary: profile.summary, skills: profile.skills, experience: profile.experience },
      null,
      1,
    ).slice(0, 16000)}\n\nJob:\n${jobText.slice(0, 8000)}`,
    maxTokens: 3000,
  }).catch(() => null);

  if (result) {
    try {
      let t = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      const s = t.indexOf("{");
      const e = t.lastIndexOf("}");
      if (s >= 0 && e > s) t = t.slice(s, e + 1);
      const parsed = JSON.parse(t) as { summary?: string; experience?: { company: string; role: string; bullets: string[] }[] };
      if (typeof parsed.summary === "string") llmSummary = parsed.summary;
      if (Array.isArray(parsed.experience)) llmExperience = parsed.experience;
    } catch {
      // keep the confirmed summary and bullets if parsing fails
    }
  }

  // enforce the constraint on every free-text field: strip any sentence
  // asserting a technology the confirmed profile does not back, whether
  // or not the job posting mentioned it
  const summaryCheck = stripUnconfirmed(llmSummary, profile);
  removedClaims.push(...summaryCheck.removed);

  const experience = profile.experience.map((base) => {
    const match = llmExperience.find((x) => x.company === base.company && x.role === base.role);
    const rawBullets = match?.bullets ?? base.bullets;
    const bullets = rawBullets
      .map((b) => {
        const c = stripUnconfirmed(b, profile);
        removedClaims.push(...c.removed);
        return c.clean;
      })
      .filter((b) => b.length > 0);
    return {
      company: base.company,
      role: base.role,
      location: base.location,
      start: base.start,
      end: base.end,
      bullets: bullets.length > 0 ? bullets : base.bullets.map((b) => stripUnconfirmed(b, profile).clean).filter(Boolean),
    };
  });

  const tailored: TailoredCv = {
    headline: profile.headline, // from the confirmed profile, never synthesized
    summary: summaryCheck.clean || profile.summary,
    skills: ordered, // strict subset of confirmed skills, reordered
    experience,
    selectedProjects: selectWorkSamples(profile, jobText),
    removedClaims: [...new Set(removedClaims)],
  };

  const diff: TailorDiff = {
    skillsAdded: emphasized,
    skillsDropped: deemphasized,
    summaryChanged: tailored.summary.trim() !== profile.summary.trim(),
  };

  return { tailored, diff, forbidden: tailored.removedClaims };
}

/**
 * The critical safety check. Returns any technology skill asserted
 * anywhere in the tailored document that the confirmed profile does not
 * back, regardless of whether the job posting asked for it. Must be
 * empty before a tailored CV is generated. jobText is unused now that
 * the check is profile-relative, kept for signature stability.
 */
export function findUnconfirmedClaims(tailored: TailoredCv, profile: Profile, _jobText?: string): string[] {
  const hay = [
    tailored.headline,
    tailored.summary,
    tailored.skills.join(" "),
    tailored.experience.map((e) => `${e.role} ${e.bullets.join(" ")}`).join(" "),
    tailored.selectedProjects.map((p) => `${p.name} ${p.description} ${p.tech.join(" ")}`).join(" "),
  ].join(" ");
  return unconfirmedSkillsIn(hay, profile);
}

/** Auto-selects the profile projects most relevant to the posting. */
export function selectWorkSamples(profile: Profile, jobText: string): ProfileProject[] {
  const jobKeywords = new Set(extractKeywords(jobText, 45).map((k) => k.toLowerCase()));
  const scored = profile.projects.map((p) => {
    const hay = `${p.name} ${p.description} ${p.tech.join(" ")}`.toLowerCase();
    const score = [...jobKeywords].filter((k) => hay.includes(k)).length;
    return { p, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.p);
}
