import { runCompletion } from "@/lib/ai/run";
import { stripUnconfirmed } from "@/lib/analysis/skills";
import type { Profile } from "./schema";

/**
 * Cover letter and common form-answer generation. Both draw only on the
 * confirmed profile, and both pass their output through the same
 * lexicon-based strip so no technology the profile cannot back up slips
 * in, whether or not the job posting mentioned it.
 */

const COVER_SYSTEM = `You write a short, direct cover letter, three or four tight paragraphs. Plain and human, no filler, no hype words, no em dashes. Use only facts from the candidate's confirmed profile. Never claim a skill or experience that is not in the profile, even if the job asks for it. Reply with only the letter body, no salutation placeholders beyond "Dear Hiring Manager,".`;

export async function generateCoverLetter(
  userId: string,
  profile: Profile,
  job: { title: string; companyName: string; description: string },
): Promise<string> {
  const result = await runCompletion({
    activity: "cover_letter",
    userId,
    system: COVER_SYSTEM,
    prompt: `Confirmed profile:\n${JSON.stringify(
      { name: profile.name, headline: profile.headline, summary: profile.summary, skills: profile.skills, experience: profile.experience.slice(0, 4) },
      null,
      1,
    ).slice(0, 12000)}\n\nJob: ${job.title} at ${job.companyName}\n${job.description.slice(0, 6000)}`,
    maxTokens: 1200,
  });
  if (!result) throw new Error("no AI provider is available to write the cover letter");
  return stripUnconfirmed(result.text.trim(), profile).clean;
}

const FORM_QUESTIONS = [
  "Why do you want to work at this company?",
  "Why are you a good fit for this role?",
  "What are your salary expectations?",
  "What is your notice period or availability?",
  "Do you require visa sponsorship?",
];

const FORM_SYSTEM = `You answer common job-application form questions for the candidate, in the first person. Short and direct, plain and human, no filler. Use only facts from the confirmed profile. Never claim a skill or experience that is not in the profile. For salary, notice period, or visa, if the profile does not state it, say the candidate should fill this in and give a brief neutral placeholder. Reply with ONLY JSON, no code fence: { "answers": [{ "question": string, "answer": string }] }`;

export async function generateFormAnswers(
  userId: string,
  profile: Profile,
  job: { title: string; companyName: string; description: string },
): Promise<{ question: string; answer: string }[]> {
  const result = await runCompletion({
    activity: "form_answers",
    userId,
    system: FORM_SYSTEM,
    prompt: `Confirmed profile:\n${JSON.stringify(
      { headline: profile.headline, summary: profile.summary, skills: profile.skills, location: profile.location },
      null,
      1,
    ).slice(0, 10000)}\n\nJob: ${job.title} at ${job.companyName}\n${job.description.slice(0, 5000)}\n\nQuestions:\n${FORM_QUESTIONS.join("\n")}`,
    maxTokens: 1500,
  });
  if (!result) {
    return FORM_QUESTIONS.map((question) => ({ question, answer: "" }));
  }
  try {
    let t = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    const parsed = JSON.parse(t) as { answers?: { answer: string }[] };
    const answers = parsed.answers ?? [];
    // the questions are fixed and ours; only the model's answers are used,
    // stripped of any unconfirmed technology claim
    return FORM_QUESTIONS.map((question, i) => ({
      question,
      answer: stripUnconfirmed(answers[i]?.answer ?? "", profile).clean,
    }));
  } catch {
    return FORM_QUESTIONS.map((question) => ({ question, answer: "" }));
  }
}
