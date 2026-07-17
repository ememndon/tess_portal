import { runCompletion } from "@/lib/ai/run";
import { scopeFor } from "@/lib/server/dal";
import { profileSchema } from "@/lib/cv/schema";

/**
 * Interview prep packs, generated the moment an interview lands on the
 * calendar. Tess pulls the posting, whatever company brief exists, the
 * user's confirmed projects, and their STAR bank, then produces likely
 * questions mapped to the user's own lived examples. Nothing is
 * fabricated about the user: mappings only ever point at real stories
 * and real projects.
 */

export type PrepPack = {
  round: string;
  likelyQuestions: { question: string; why: string; drawOn: string }[];
  companyTalkingPoints: string[];
  yourStories: { title: string; competency: string }[];
  yourProjects: string[];
  reminders: string[];
  generatedAt: string;
  model: string | null;
};

const PREP_SYSTEM = `You prepare a candidate for a specific interview. You are given the job posting, an optional company brief, the candidate's confirmed projects, and the titles of STAR stories they have on file. Produce likely interview questions and map each to something the candidate can actually draw on.

Hard rules:
- Base questions on the posting and company. Do not invent details about the candidate.
- The "drawOn" for each question must reference one of the candidate's listed projects or story titles, or say "prepare a fresh example" when none fits. Never invent a project or story.

Reply with ONLY JSON, no code fence:
{
  "likelyQuestions": [{ "question": string, "why": string, "drawOn": string }],   // 6-10 items
  "companyTalkingPoints": string[],   // 3-5, grounded in the brief or posting
  "reminders": string[]               // 2-4 practical reminders for this round
}`;

function fallbackQuestions(round: string): PrepPack["likelyQuestions"] {
  return [
    { question: "Walk me through your background and why this role.", why: "Almost every interview opens here.", drawOn: "prepare a fresh 90-second summary" },
    { question: "Tell me about a hard technical problem you solved.", why: "Tests depth and ownership.", drawOn: "pick a project from your profile" },
    { question: "Describe a time you disagreed with a teammate.", why: "Behavioral, collaboration signal.", drawOn: "prepare a fresh example" },
    { question: "Why this company specifically?", why: "Tests genuine interest.", drawOn: "use the company brief" },
    { question: "What questions do you have for us?", why: "Always asked, judged closely.", drawOn: "prepare 3 sharp questions" },
  ].concat(
    round.toLowerCase().includes("system") || round.toLowerCase().includes("design")
      ? [{ question: "Design a system for the described use case.", why: "System design round.", drawOn: "prepare a fresh example" }]
      : [],
  );
}

export async function generatePrepPack(userId: string, interviewId: string): Promise<PrepPack | null> {
  const scope = scopeFor(userId);
  const detail = await scope.getInterview(interviewId);
  if (!detail) return null;

  const [confirmed, stories, company] = await Promise.all([
    scope.getConfirmedProfileData(),
    scope.listStories(),
    // best-effort: match the job's company to a tracked company for its brief
    (async () => {
      const companies = await scope.listCompanies();
      return companies.find((c) => c.name.toLowerCase() === detail.jobCompany.toLowerCase()) ?? null;
    })(),
  ]);

  const profile = confirmed ? profileSchema.parse(confirmed) : null;
  const projects = profile ? profile.projects.map((p) => p.name).filter(Boolean) : [];
  const brief =
    ((company?.brief as { research?: { summary?: string; talkingPoints?: string[] } } | null)?.research) ?? null;

  const prompt = [
    `Role: ${detail.jobTitle} at ${detail.jobCompany}. Round: ${detail.interview.round}.`,
    detail.jobDescription ? `Posting:\n${detail.jobDescription.slice(0, 4000)}` : "No posting text on file.",
    brief?.summary ? `Company brief: ${brief.summary}` : "",
    brief?.talkingPoints?.length ? `Brief talking points: ${brief.talkingPoints.join("; ")}` : "",
    projects.length ? `Candidate projects: ${projects.join(", ")}` : "No projects on file.",
    stories.length ? `Candidate STAR stories: ${stories.map((s) => `${s.title} (${s.competency})`).join(", ")}` : "No STAR stories on file.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const completion = await runCompletion({
    activity: "interview_prep",
    userId,
    system: PREP_SYSTEM,
    prompt,
    maxTokens: 1600,
  }).catch(() => null);

  let likelyQuestions = fallbackQuestions(detail.interview.round);
  let companyTalkingPoints = brief?.talkingPoints ?? [];
  let reminders = ["Confirm the time and link.", "Re-read the posting an hour before.", "Have your questions written down."];

  if (completion?.text) {
    try {
      const cleaned = completion.text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleaned) as Partial<PrepPack> & {
        likelyQuestions?: PrepPack["likelyQuestions"];
      };
      if (Array.isArray(parsed.likelyQuestions) && parsed.likelyQuestions.length > 0) {
        likelyQuestions = parsed.likelyQuestions.slice(0, 12);
      }
      if (Array.isArray(parsed.companyTalkingPoints)) companyTalkingPoints = parsed.companyTalkingPoints.slice(0, 6);
      if (Array.isArray(parsed.reminders) && parsed.reminders.length) reminders = parsed.reminders.slice(0, 5);
    } catch {
      // keep fallbacks
    }
  }

  const pack: PrepPack = {
    round: detail.interview.round,
    likelyQuestions,
    companyTalkingPoints,
    yourStories: stories.map((s) => ({ title: s.title, competency: s.competency })),
    yourProjects: projects,
    reminders,
    generatedAt: new Date().toISOString(),
    model: completion ? `${completion.provider}:${completion.model}` : null,
  };

  await scope.savePrepPack({ interviewId, jobId: detail.jobId, content: pack });
  return pack;
}
