import { runCompletion } from "@/lib/ai/run";
import { stripUnconfirmed } from "@/lib/analysis/skills";
import type { Profile } from "@/lib/cv/schema";
import { scopeFor } from "./dal";

/**
 * Tess drafts a mailbox message on the user's behalf. Draws only on the
 * confirmed profile so nothing is invented, and passes the result through
 * the same lexicon strip the cover-letter path uses. Returns plain text;
 * the compose UI decides how to place it (above any quote or signature).
 */

export type DraftMode = "new" | "reply" | "forward";

const SYSTEM = `You are Tess, drafting an email on behalf of a job seeker. Write it in their first person, ready to send.
Rules:
- Warm, direct, and human. Short. No filler, no hype words, no em dashes.
- Use ONLY facts from the candidate's confirmed profile. Never claim a skill, employer, or experience that is not in the profile, even if asked.
- If replying, answer the quoted email directly and stay on its topic.
- Do not invent names, dates, links, or attachments.
- End with a simple sign-off using the candidate's first name.
Reply with ONLY JSON, no code fence: { "subject": string, "body": string }. For a reply, "subject" may be an empty string.`;

function firstName(name?: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export async function draftMailBody(input: {
  userId: string;
  mode: DraftMode;
  to?: string;
  subject?: string;
  quoted?: string;
  instruction?: string;
}): Promise<{ subject: string; body: string }> {
  const data = (await scopeFor(input.userId).getConfirmedProfileData()) as Profile | null;

  const profileBlock = data
    ? JSON.stringify(
        {
          name: data.name,
          headline: data.headline,
          summary: data.summary,
          skills: data.skills,
          location: data.location,
          experience: Array.isArray(data.experience) ? data.experience.slice(0, 3) : undefined,
        },
        null,
        1,
      ).slice(0, 8000)
    : "(no confirmed profile yet — keep the message generic and do not invent any details)";

  const parts: string[] = [`Confirmed profile:\n${profileBlock}`];
  parts.push(
    input.mode === "reply"
      ? "Task: write a reply to the email below."
      : input.mode === "forward"
        ? "Task: write a short note to accompany this forwarded email."
        : "Task: write a new outreach email.",
  );
  if (input.to) parts.push(`Recipient: ${input.to}`);
  if (input.subject) parts.push(`Subject so far: ${input.subject}`);
  if (input.instruction?.trim()) parts.push(`What the sender wants to say: ${input.instruction.trim().slice(0, 1000)}`);
  if (input.quoted?.trim()) parts.push(`Email being ${input.mode === "forward" ? "forwarded" : "replied to"}:\n${input.quoted.trim().slice(0, 6000)}`);

  const result = await runCompletion({
    activity: "outreach_draft",
    userId: input.userId,
    system: SYSTEM,
    prompt: parts.join("\n\n"),
    maxTokens: 900,
  });
  if (!result) throw new Error("no AI provider is available to draft this message");

  let subject = input.subject ?? "";
  let body = "";
  try {
    let t = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    const parsed = JSON.parse(t) as { subject?: string; body?: string };
    body = (parsed.body ?? "").trim();
    if (input.mode === "new" && !subject.trim() && parsed.subject?.trim()) subject = parsed.subject.trim();
  } catch {
    // model didn't return JSON — treat the whole thing as the body
    body = result.text.trim();
  }
  if (!body) throw new Error("the draft came back empty, try again");

  // never let an unconfirmed skill claim slip in
  if (data) body = stripUnconfirmed(body, data).clean;

  // guard against a stray sign-off placeholder
  const fn = firstName(data?.name);
  if (fn) body = body.replace(/\[?\byour name\b\]?/gi, fn);

  return { subject, body: body.slice(0, 8000) };
}
