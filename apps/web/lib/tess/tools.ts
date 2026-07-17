import type { CoreTool } from "ai";
import { DateTime } from "luxon";
import { z } from "zod";
import { PICKABLE_CURRENCIES } from "../currency";
import { JOB_STAGES, scopeFor } from "../server/dal";
import { createApproval, registerApprovalExecutor } from "../server/approvals";
import { createNotification } from "../server/notify";
import { audit } from "../server/audit";

/**
 * Tess's tool layer. Two action classes, and the split is enforced
 * HERE, in the execution layer: safe tools run directly, sensitive
 * tools never do. Every sensitive definition routes through
 * gateSensitive(), which creates an approval record instead of
 * executing, no matter which path invoked the tool: chat, a playbook,
 * or a scheduled run. No prompt or model choice can bypass it because
 * this registry is the only executor.
 */

type ToolDef = {
  description: string;
  parameters: z.ZodTypeAny;
  sensitive: boolean;
  run: (userId: string, args: never) => Promise<unknown>;
};

async function gateSensitive(
  userId: string,
  kind: string,
  title: string,
  summary: string,
  payload: Record<string, unknown>,
) {
  const approval = await createApproval({ userId, kind, title, summary, payload });
  return {
    approvalRequired: true,
    approvalId: approval.id,
    title,
    summary,
    note: "This action waits for the user's explicit approval. It has not run.",
  };
}

/* ---------- approval executors: what runs after a yes ---------- */

registerApprovalExecutor("outreach.send", async (userId, payload) => {
  const p = payload as {
    toEmail?: string;
    subject?: string;
    body: string;
    jobId?: string;
    contactId?: string;
    sequenceId?: string;
    variant?: string;
  };
  const { executeOutreachSend } = await import("../server/outreach");
  const result = await executeOutreachSend(userId, {
    toEmail: p.toEmail,
    subject: p.subject,
    body: p.body,
    jobId: p.jobId ?? null,
    contactId: p.contactId ?? null,
    sequenceId: p.sequenceId ?? null,
    variant: p.variant ?? null,
  });
  await createNotification(userId, {
    type: result.sent ? "outreach.sent" : "outreach.ready",
    title: result.sent ? "Outreach sent from your mailbox" : "Approved outreach is ready to copy and send",
    body: p.subject ?? "",
    href: "/outreach",
  }).catch(() => {});
  return { summary: result.summary };
});

registerApprovalExecutor("job.delete", async (userId, payload) => {
  const p = payload as { jobId: string; jobTitle?: string };
  const ok = await scopeFor(userId).deleteJob(p.jobId);
  if (!ok) throw new Error("job no longer exists");
  return { summary: `deleted job ${p.jobTitle ?? p.jobId} and its history` };
});

/* ---------- the registry ---------- */

function defs(userId: string): Record<string, ToolDef> {
  const scope = scopeFor(userId);
  return {
    get_overview: {
      description:
        "Snapshot of what needs attention: funnel counts per stage, upcoming events, and pending approvals. Use for questions like what needs my attention today.",
      parameters: z.object({}),
      sensitive: false,
      run: async () => {
        const [funnel, events, jobs] = await Promise.all([
          scope.funnelStats(),
          scope.upcomingEvents(7),
          scope.listJobs(),
        ]);
        const { listPendingApprovals } = await import("../server/approvals");
        const approvals = await listPendingApprovals(userId);
        return {
          funnel,
          upcomingEvents: events.map((e) => ({ title: e.title, startsAt: e.startsAt, kind: e.kind })),
          pendingApprovals: approvals.map((a) => ({ title: a.title, summary: a.summary })),
          staleJobs: jobs
            .filter((j) => ["saved", "researching"].includes(j.stage))
            .filter((j) => Date.now() - j.updatedAt.getTime() > 5 * 24 * 3600 * 1000)
            .map((j) => ({ id: j.id, title: j.title, company: j.companyName, stage: j.stage })),
        };
      },
    },
    search_jobs: {
      description: "List the user's pipeline jobs, optionally filtered by stage or a text needle.",
      parameters: z.object({
        stage: z.enum(JOB_STAGES).optional(),
        query: z.string().max(100).optional(),
      }),
      sensitive: false,
      run: async (_u, args: { stage?: (typeof JOB_STAGES)[number]; query?: string }) => {
        let jobs = await scope.listJobs();
        if (args.stage) jobs = jobs.filter((j) => j.stage === args.stage);
        if (args.query) {
          const q = args.query.toLowerCase();
          jobs = jobs.filter(
            (j) =>
              j.title.toLowerCase().includes(q) ||
              j.companyName.toLowerCase().includes(q) ||
              (j.location ?? "").toLowerCase().includes(q),
          );
        }
        return jobs.slice(0, 25).map((j) => ({
          id: j.id,
          title: j.title,
          company: j.companyName,
          location: j.location,
          stage: j.stage,
          salary: j.salaryRaw,
          url: j.url,
        }));
      },
    },
    get_job: {
      description: "Full detail of one job including description, notes, and timeline.",
      parameters: z.object({ jobId: z.string().uuid() }),
      sensitive: false,
      run: async (_u, args: { jobId: string }) => {
        const job = await scope.getJob(args.jobId);
        if (!job) return { error: "job not found" };
        const activities = await scope.listJobActivities(args.jobId);
        return { job, timeline: activities.slice(0, 20) };
      },
    },
    save_job: {
      description: "Save a new job into the pipeline at the Saved stage. Safe, stays in the platform.",
      parameters: z.object({
        title: z.string().min(1).max(200),
        companyName: z.string().min(1).max(160),
        location: z.string().max(120).optional(),
        url: z.string().url().optional(),
        salaryRaw: z.string().max(200).optional(),
        description: z.string().max(30000).optional(),
      }),
      sensitive: false,
      run: async (_u, args: { title: string; companyName: string; location?: string; url?: string; salaryRaw?: string; description?: string }) => {
        const job = await scope.createJob({ ...args, source: "manual" });
        return { saved: true, jobId: job.id };
      },
    },
    update_job_stage: {
      description: "Move a job to another pipeline stage. The timeline records the change.",
      parameters: z.object({ jobId: z.string().uuid(), stage: z.enum(JOB_STAGES) }),
      sensitive: false,
      run: async (_u, args: { jobId: string; stage: (typeof JOB_STAGES)[number] }) => {
        const job = await scope.moveJobStage(args.jobId, args.stage);
        return job ? { moved: true, stage: job.stage } : { error: "job not found" };
      },
    },
    add_job_note: {
      description: "Add a note to a job's timeline.",
      parameters: z.object({ jobId: z.string().uuid(), note: z.string().min(1).max(5000) }),
      sensitive: false,
      run: async (_u, args: { jobId: string; note: string }) => {
        const added = await scope.addJobNote(args.jobId, args.note);
        return added ? { noted: true } : { error: "job not found" };
      },
    },
    list_documents: {
      description: "List the user's documents and versions, including which job each version went to.",
      parameters: z.object({}),
      sensitive: false,
      run: async () => {
        const docs = await scope.listDocuments();
        return docs.map((d) => ({
          id: d.id,
          title: d.title,
          kind: d.kind,
          versions: d.versions.map((v) => ({ version: v.version, fileName: v.fileName, jobId: v.jobId })),
        }));
      },
    },
    list_contacts: {
      description: "List the user's outreach contacts.",
      parameters: z.object({}),
      sensitive: false,
      run: async () => scope.listContacts(),
    },
    add_contact: {
      description: "Save a contact person. Safe, stays in the platform.",
      parameters: z.object({
        name: z.string().min(1).max(160),
        role: z.string().max(120).optional(),
        companyName: z.string().max(160).optional(),
        email: z.string().email().optional(),
        linkedin: z.string().url().optional(),
        notes: z.string().max(2000).optional(),
      }),
      sensitive: false,
      run: async (_u, args: { name: string; role?: string; companyName?: string; email?: string; linkedin?: string; notes?: string }) => {
        const c = await scope.createContact(args);
        return { added: true, contactId: c.id };
      },
    },
    list_calendar: {
      description: "Upcoming calendar events in the next N days.",
      parameters: z.object({ days: z.number().int().min(1).max(60).default(14) }),
      sensitive: false,
      run: async (_u, args: { days: number }) => {
        const events = await scope.upcomingEvents(args.days);
        return events.map((e) => ({ title: e.title, startsAt: e.startsAt, kind: e.kind, location: e.location }));
      },
    },
    create_calendar_event: {
      description:
        "Create a calendar event with optional email reminders. localDateTime is naive and interpreted in the user's timezone.",
      parameters: z.object({
        title: z.string().min(1).max(200),
        localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
        durationMin: z.number().int().min(0).max(1440).default(60),
        location: z.string().max(500).optional(),
        notes: z.string().max(2000).optional(),
        reminderLeadMinutes: z.array(z.number().int().min(5).max(20160)).max(4).default([]),
      }),
      sensitive: false,
      run: async (
        _u,
        args: { title: string; localDateTime: string; durationMin: number; location?: string; notes?: string; reminderLeadMinutes: number[] },
      ) => {
        const settings = await scope.getSettings();
        const start = DateTime.fromISO(args.localDateTime, { zone: settings.timezone });
        if (!start.isValid) return { error: "that date and time do not parse" };
        const event = await scope.createCustomEvent({
          title: args.title,
          startsAt: start.toJSDate(),
          endsAt: start.plus({ minutes: args.durationMin }).toJSDate(),
          location: args.location,
          notes: args.notes,
          reminderLeadMinutes: args.reminderLeadMinutes,
        });
        return { created: true, eventId: event.id };
      },
    },
    get_standing_instructions: {
      description: "Read the user's standing instructions, the rules Tess always obeys.",
      parameters: z.object({}),
      sensitive: false,
      run: async () => scope.listStandingInstructions(),
    },
    add_standing_instruction: {
      description: "Save a new standing instruction when the user states a lasting rule.",
      parameters: z.object({ instruction: z.string().min(3).max(1000) }),
      sensitive: false,
      run: async (_u, args: { instruction: string }) => {
        await scope.addStandingInstruction(args.instruction);
        return { saved: true };
      },
    },
    update_learned_profile: {
      description:
        "Record facts learned about the user over time, like salary floor or preferred titles. Keys are short snake_case fact names. Set a value to an empty string to remove it. The user can see and edit everything.",
      parameters: z.object({ facts: z.record(z.string().max(500)) }),
      sensitive: false,
      run: async (_u, args: { facts: Record<string, string> }) => {
        const merged = await scope.updateLearnedProfile(args.facts);
        return { learnedProfile: merged };
      },
    },
    draft_outreach: {
      description:
        "Store an outreach email draft for the user to review. Drafting is safe and automatic; SENDING is a separate sensitive tool.",
      parameters: z.object({
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(20000),
        jobId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
      }),
      sensitive: false,
      run: async (_u, args: { subject: string; body: string; jobId?: string; contactId?: string }) => {
        const row = await scope.createOutreachMessage({ ...args, status: "draft" });
        return { drafted: true, messageId: row.id };
      },
    },
    suggest_hiring_contacts: {
      description:
        "Suggest likely hiring-manager or recruiter contacts at a company, with sources and search links. This never adds a contact, the user confirms each one.",
      parameters: z.object({ company: z.string().min(1).max(160), website: z.string().url().optional() }),
      sensitive: false,
      run: async (_u, args: { company: string; website?: string }) => {
        const { findHiringContacts } = await import("../server/hiring-finder");
        const result = await findHiringContacts(args.company, args.website ?? null);
        return {
          note: "Suggestions only. Confirm or correct each before adding it as a contact.",
          suggestions: result.suggestions,
          searchLinks: result.searchLinks,
        };
      },
    },
    create_outreach_sequence: {
      description:
        "Create a follow-up sequence for a job and contact, with a cadence of steps (waitDays between each). Reminders fire when steps are due and the sequence stops automatically if the contact replies. Sending each message still needs approval.",
      parameters: z.object({
        name: z.string().min(1).max(160),
        jobId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        steps: z
          .array(z.object({ kind: z.enum(["email", "follow_up", "recruiter_message", "board_application"]), waitDays: z.number().int().min(0).max(60) }))
          .min(1)
          .max(8),
      }),
      sensitive: false,
      run: async (_u, args: { name: string; jobId?: string; contactId?: string; steps: { kind: string; waitDays: number }[] }) => {
        const seq = await scope.createSequence(args);
        return { created: true, sequenceId: seq.id };
      },
    },
    send_outreach_email: {
      description:
        "SENSITIVE. Ask to send an outreach email. This always creates an approval the user must confirm; nothing sends without it.",
      parameters: z.object({
        toEmail: z.string().email(),
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(20000),
        jobId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
      }),
      sensitive: true,
      run: async (_u, args: { toEmail: string; subject: string; body: string; jobId?: string; contactId?: string }) =>
        gateSensitive(
          userId,
          "outreach.send",
          `Outreach email to ${args.toEmail}`,
          `Subject: ${args.subject}. ${args.body.split(/\s+/).length} words.`,
          args,
        ),
    },
    research_company: {
      description:
        "Research a company and produce a sourced brief (what they do, stack, news, sponsorship, interview talking points). Fetches the company's own site and cites the exact source URLs. Safe, stays in the platform. Give a website when you have one for real sources.",
      parameters: z.object({
        company: z.string().min(1).max(160),
        website: z.string().url().optional(),
      }),
      sensitive: false,
      run: async (_u, args: { company: string; website?: string }) => {
        const company = await scope.getOrCreateCompany({ name: args.company, website: args.website });
        const { buildCompanyBrief } = await import("../intel/brief");
        const brief = await buildCompanyBrief({
          userId,
          name: company.name,
          website: company.website ?? args.website ?? null,
          sponsorStatus: company.sponsorStatus,
        });
        await scope.saveCompanyBrief(company.id, brief);
        return { companyId: company.id, brief };
      },
    },
    recommend_companies: {
      description:
        "Suggest companies the user should target, computed from their own pipeline and profile. Each suggestion states its reason. No external calls.",
      parameters: z.object({}),
      sensitive: false,
      run: async () => {
        const { recommendCompanies } = await import("../intel/recommend");
        const recommendations = await recommendCompanies(userId);
        return { recommendations };
      },
    },
    salary_intel: {
      description:
        "Salary intelligence for a role, aggregated from the user's jobs database, with sample sizes. Each band is reported in its market's own currency (carried on the band as `currency`) unless `currency` forces one. Optionally returns a data-grounded negotiation script. Never invents a market rate.",
      parameters: z.object({
        role: z.string().min(1).max(160),
        market: z.string().max(60).optional(),
        currentOffer: z.number().int().min(0).max(100_000_000).optional(),
        currency: z.enum(PICKABLE_CURRENCIES).optional(),
        wantScript: z.boolean().default(false),
      }),
      sensitive: false,
      run: async (
        _u,
        args: { role: string; market?: string; currentOffer?: number; currency?: string; wantScript: boolean },
      ) => {
        const { salaryBands, negotiationScript, roleKey } = await import("../intel/salary");
        const bands = await salaryBands(userId, { currency: args.currency });
        const want = roleKey(args.role);
        const relevant = bands.filter((b) => b.role === want);
        const script = args.wantScript
          ? await negotiationScript(userId, {
              role: args.role,
              market: args.market,
              currentOffer: args.currentOffer,
              currency: args.currency,
            })
          : null;
        return { bands: relevant.length ? relevant : bands.slice(0, 6), script };
      },
    },
    add_star_story: {
      description:
        "Save a STAR story (situation, task, action, result) to the user's story bank under a competency, so it can be pulled up for interviews. Safe, stays in the platform.",
      parameters: z.object({
        title: z.string().min(1).max(200),
        competency: z.string().min(1).max(120),
        situation: z.string().max(4000).optional(),
        task: z.string().max(4000).optional(),
        action: z.string().max(4000).optional(),
        result: z.string().max(4000).optional(),
      }),
      sensitive: false,
      run: async (
        _u,
        args: { title: string; competency: string; situation?: string; task?: string; action?: string; result?: string },
      ) => {
        const { embedText } = await import("../ai/run");
        const text = [args.title, args.competency, args.situation, args.task, args.action, args.result]
          .filter(Boolean)
          .join("\n");
        const embedding = await embedText(userId, text).catch(() => null);
        const story = await scope.createStory({ ...args, embedding });
        return { added: true, storyId: story.id };
      },
    },
    mock_interview_questions: {
      description:
        "Get likely interview questions for a pipeline job to run a mock interview. Returns questions mapped to the user's own projects and STAR stories. Use these to conduct a mock interview in chat: ask one at a time, then give honest, specific feedback on each answer.",
      parameters: z.object({ jobId: z.string().uuid() }),
      sensitive: false,
      run: async (_u, args: { jobId: string }) => {
        const job = await scope.getJob(args.jobId);
        if (!job) return { error: "job not found" };
        const [confirmed, stories] = await Promise.all([
          scope.getConfirmedProfileData(),
          scope.listStories(),
        ]);
        const { runCompletion } = await import("../ai/run");
        const { profileSchema } = await import("../cv/schema");
        const profile = confirmed ? profileSchema.parse(confirmed) : null;
        const projects = profile ? profile.projects.map((p) => p.name).filter(Boolean) : [];
        const prompt = [
          `Role: ${job.title} at ${job.companyName}.`,
          job.description ? `Posting:\n${job.description.slice(0, 3500)}` : "No posting text.",
          projects.length ? `Candidate projects: ${projects.join(", ")}` : "",
          stories.length ? `STAR stories: ${stories.map((s) => `${s.title} (${s.competency})`).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const completion = await runCompletion({
          activity: "mock_interview",
          userId,
          system:
            "Generate 6 likely interview questions for this specific role from the posting. Reply with ONLY a JSON array of strings, no code fence.",
          prompt,
          maxTokens: 700,
        }).catch(() => null);
        let questions: string[] = [];
        if (completion?.text) {
          try {
            const cleaned = completion.text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) questions = parsed.map(String).slice(0, 8);
          } catch {
            questions = [];
          }
        }
        if (questions.length === 0) {
          questions = [
            "Walk me through your background and why this role.",
            "Tell me about a hard technical problem you solved recently.",
            "Describe a time you disagreed with a teammate and how you resolved it.",
            `Why ${job.companyName} specifically?`,
            "What questions do you have for us?",
          ];
        }
        return {
          role: `${job.title} at ${job.companyName}`,
          questions,
          yourStories: stories.map((s) => ({ title: s.title, competency: s.competency })),
          yourProjects: projects,
          instructions: "Conduct the mock interview one question at a time. After each answer, give specific feedback: what landed, what to tighten, and which of the user's real stories or projects would strengthen it.",
        };
      },
    },
    delete_job: {
      description:
        "SENSITIVE. Ask to delete a job and its entire history. This always creates an approval the user must confirm.",
      parameters: z.object({ jobId: z.string().uuid() }),
      sensitive: true,
      run: async (_u, args: { jobId: string }) => {
        const job = await scope.getJob(args.jobId);
        if (!job) return { error: "job not found" };
        return gateSensitive(
          userId,
          "job.delete",
          `Delete job: ${job.title} at ${job.companyName}`,
          "Removes the job, its timeline, snapshot, and interviews. Hard to undo.",
          { jobId: args.jobId, jobTitle: `${job.title} at ${job.companyName}` },
        );
      },
    },
  };
}

/**
 * Builds AI SDK tools for one user. The execute callback below is the
 * single gate: sensitive definitions can only ever reach
 * gateSensitive() inside their run(), and the registry is the only
 * path any caller (chat, playbook, scheduled run) has to a tool.
 */
export function buildToolsFor(userId: string, source: "chat" | "playbook" | "scheduled") {
  const registry = defs(userId);
  const tools: Record<string, CoreTool> = {};
  for (const [name, def] of Object.entries(registry)) {
    tools[name] = {
      description: def.description,
      parameters: def.parameters,
      execute: async (args: never) => {
        try {
          const result = await def.run(userId, args);
          if (def.sensitive) {
            await audit({
              userId,
              action: "tool.sensitive_gated",
              targetType: "tool",
              targetId: name,
              snapshot: { source, args },
            });
          }
          return result;
        } catch (err) {
          return { error: (err as Error).message.slice(0, 300) };
        }
      },
    } as unknown as CoreTool;
  }
  return tools;
}

/** Direct execution path for playbooks and scheduled runs. Same gate. */
export async function executeToolDirect(
  userId: string,
  source: "playbook" | "scheduled",
  name: string,
  args: unknown,
): Promise<unknown> {
  const registry = defs(userId);
  const def = registry[name];
  if (!def) return { error: `unknown tool ${name}` };
  const parsed = def.parameters.safeParse(args);
  if (!parsed.success) return { error: "invalid tool arguments" };
  if (def.sensitive) {
    await audit({
      userId,
      action: "tool.sensitive_gated",
      targetType: "tool",
      targetId: name,
      snapshot: { source, args: parsed.data },
    });
  }
  return def.run(userId, parsed.data as never);
}
