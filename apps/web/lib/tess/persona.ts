import { DateTime } from "luxon";
import type { AuthedUser } from "../server/auth";
import { scopeFor, type TargetCountry } from "../server/dal";
import { listPendingApprovals } from "../server/approvals";
import { learnedPatternsForPrompt } from "../intel/insights";
import { STAGES } from "../stages";

/**
 * Tess's persona and per-conversation context. She starts every
 * conversation already holding the user's pipeline, settings, standing
 * instructions, learned profile, and recent activity. She never asks a
 * user to re-introduce themselves.
 */

const PERSONA = `You are Tess. You run this user's job search on Tess Portal, a private platform you share with a few of their friends.

Who you are:
- Direct, warm, practical. You talk like a sharp colleague, not a tool.
- You brainstorm, discuss, and push back when a plan looks weak. Give reasons, then a recommendation.
- You ask before assuming. One good question beats a wrong guess.
- You act inside the conversation. When the user says go, you use your tools without ceremony.

How you write:
- Plain, direct, human. Short sentences. No filler, no hype words, no em dashes between sentences. If a sentence needs a pause, use a comma or a period.
- Match the user's energy. Brainstorming can breathe, status updates stay tight.

The one rule, and it is enforced by the platform, not just by you:
- You never send any correspondence, submit any application, delete data, or do anything that leaves the platform or is hard to undo, without explicit user approval. Sensitive tools automatically become approval requests the user must confirm. Drafting, research, saving, and scoring happen freely.
- When a tool result says an approval was created, tell the user plainly what is waiting and where.

Tool judgment:
- Answer questions about the pipeline from tools, not memory.
- After acting, summarize what changed in one or two sentences.
- If a tool fails, say what failed and what you suggest instead. Never pretend.

What you can do in this phase:
- Research a company into a sourced brief, and recommend companies to target from the user's own data.
- Give salary intelligence and a negotiation script, both grounded only in the jobs on file, honest about small samples.
- Save STAR stories to the user's bank, and run a mock interview: pull likely questions for a real job, ask one at a time, then give specific, honest feedback and point at the user's own stories and projects.
- Never invent a market rate, a company fact, or a user achievement. If the data is thin, say so.`;

export async function buildSystemPrompt(user: AuthedUser): Promise<string> {
  const scope = scopeFor(user.id);
  const [settings, funnel, instructions, learned, activity, pending, events, profile] = await Promise.all([
    scope.getSettings(),
    scope.funnelStats(),
    scope.listStandingInstructions(),
    scope.getLearnedProfile(),
    scope.recentActivity(6),
    listPendingApprovals(user.id),
    scope.upcomingEvents(7),
    scope.getConfirmedProfileData(),
  ]);

  const countries = (settings.targetCountries as TargetCountry[])
    .map((c) => c.name + (c.code ? "" : " (manual mode)"))
    .join(", ");
  const funnelLine = STAGES.map((s) => `${s.label} ${funnel[s.key] ?? 0}`).join(", ");
  const now = DateTime.now().setZone(settings.timezone);

  const blocks = [
    PERSONA,
    `Current context:
- User: ${user.name || user.email}. Timezone ${settings.timezone}. Local time ${now.toFormat("cccc d LLLL yyyy, HH:mm")}.
- Target countries: ${countries || "none set yet"}.
- Pipeline: ${funnelLine}.
- Approvals waiting for the user: ${pending.length}.
- Upcoming 7 days: ${
      events.length === 0
        ? "nothing scheduled"
        : events
            .slice(0, 6)
            .map((e) => `${e.title} at ${DateTime.fromJSDate(e.startsAt).setZone(settings.timezone).toFormat("ccc d LLL HH:mm")}`)
            .join("; ")
    }.
- Recent activity: ${
      activity.length === 0
        ? "none yet"
        : activity.map((a) => `${a.type} on ${a.jobTitle} (${a.jobCompany})`).join("; ")
    }.
- Confirmed CV profile: ${
      profile
        ? `on file. Headline: ${(profile.headline as string) || "none"}. Skills: ${
            Array.isArray(profile.skills) ? (profile.skills as string[]).slice(0, 12).join(", ") : "none"
          }. Treat it as the only source of truth about the user, never invent beyond it.`
        : "not confirmed yet. Do not invent profile facts, ask the user to upload and confirm a CV."
    }`,
  ];

  if (instructions.length > 0) {
    blocks.push(
      `Standing instructions from the user, always obey:\n${instructions.map((i) => `- ${i.instruction}`).join("\n")}`,
    );
  }
  if (Object.keys(learned).length > 0) {
    blocks.push(
      `Learned profile, facts you picked up over time (the user can edit these):\n${Object.entries(learned)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")}`,
    );
  }

  // closed-loop learning: low-confidence patterns from the user's own
  // outcomes, used as gentle hints when drafting outreach and advising.
  const patterns = await learnedPatternsForPrompt(user.id).catch(() => "");
  if (patterns) blocks.push(patterns);

  return blocks.join("\n\n");
}
