import { and, asc, desc, eq } from "drizzle-orm";
import { generateText } from "ai";
import { schema } from "@tessportal/db";
import { getDb } from "./db";
import { getLogger } from "./health";
import { createApproval, registerApprovalExecutor } from "./approvals";
import { createNotification } from "./notify";
import { buildToolsFor } from "../tess/tools";
import { resolveModel } from "../ai/router";
import { isGloballyPaused, recordUsage } from "../ai/meter";
import { providerSemaphore } from "../ai/run";

const { playbooks, playbookSteps, playbookRuns, users } = schema;

/**
 * Playbooks: user-written procedures Tess follows step by step. Every
 * step is flagged auto (Tess may do alone) or ask_first (Tess must ask
 * first). ask_first steps create an approval and the run waits; on
 * approval the run resumes. Sensitive tools used inside any step still
 * hit the execution-layer gate on top of this.
 */

export type StepLogEntry = {
  stepId: string;
  position: number;
  instruction: string;
  mode: string;
  status: "done" | "waiting_approval" | "failed" | "skipped" | "pending";
  resultSummary?: string;
  approvalId?: string;
};

const BUILTINS: { title: string; trigger: string; category: string; steps: { instruction: string; mode: "auto" | "ask_first" }[] }[] = [
  {
    title: "Full application prep",
    trigger: "When the user asks to prepare an application for a job",
    category: "applications",
    steps: [
      { instruction: "Look up the job the user named and add a note to its timeline summarizing the top requirements and any gaps to address.", mode: "auto" },
      { instruction: "Draft an outreach email to a likely hiring manager for this job and store it as a draft for review.", mode: "auto" },
      { instruction: "Send the drafted outreach email to the hiring manager contact.", mode: "ask_first" },
    ],
  },
  {
    title: "Weekly review",
    trigger: "Weekly, or when the user asks for a review",
    category: "review",
    steps: [
      { instruction: "Get the overview and summarize what needs attention: stale jobs, upcoming interviews, and pending approvals.", mode: "auto" },
      { instruction: "For each job that has not moved in over two weeks, add a note with one concrete suggested next action.", mode: "auto" },
    ],
  },
  {
    title: "Interview scheduled",
    trigger: "When a new interview lands on the calendar",
    category: "interviews",
    steps: [
      { instruction: "Check the next upcoming interview and create a calendar reminder event two hours before it if one does not exist.", mode: "auto" },
      { instruction: "Draft a short confirmation reply to the interviewer and send it.", mode: "ask_first" },
    ],
  },
];

export async function seedBuiltinPlaybooks(userId: string) {
  const db = getDb();
  const existing = await db
    .select({ id: playbooks.id })
    .from(playbooks)
    .where(and(eq(playbooks.userId, userId), eq(playbooks.builtin, true)))
    .limit(1);
  if (existing[0]) return;
  for (const b of BUILTINS) {
    const [pb] = await db
      .insert(playbooks)
      .values({ userId, title: b.title, trigger: b.trigger, category: b.category, builtin: true })
      .returning();
    for (let i = 0; i < b.steps.length; i++) {
      await db.insert(playbookSteps).values({
        userId,
        playbookId: pb.id,
        position: i,
        instruction: b.steps[i].instruction,
        mode: b.steps[i].mode,
      });
    }
  }
}

export async function listPlaybooks(userId: string) {
  const db = getDb();
  const pbs = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.userId, userId))
    .orderBy(desc(playbooks.updatedAt));
  const steps = await db
    .select()
    .from(playbookSteps)
    .where(eq(playbookSteps.userId, userId))
    .orderBy(asc(playbookSteps.position));
  const runs = await db
    .select()
    .from(playbookRuns)
    .where(eq(playbookRuns.userId, userId))
    .orderBy(desc(playbookRuns.startedAt))
    .limit(30);
  return pbs.map((p) => ({
    ...p,
    steps: steps.filter((s) => s.playbookId === p.id),
    runs: runs.filter((r) => r.playbookId === p.id),
  }));
}

/** Runs one natural-language step through Tess's tool loop. */
async function executeStepInstruction(userId: string, instruction: string): Promise<string> {
  const resolved = await resolveModel("playbook_step");
  if (!resolved) throw new Error("no AI provider available");
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const { buildSystemPrompt } = await import("../tess/persona");
  const system = `${await buildSystemPrompt(user)}\n\nYou are executing one step of a playbook the user wrote. Do exactly what the step says using your tools, then report the outcome in one or two sentences.`;
  const result = await providerSemaphore(resolved.provider).run(() =>
    generateText({
      model: resolved.model,
      system,
      prompt: `Playbook step: ${instruction}`,
      tools: buildToolsFor(userId, "playbook"),
      maxSteps: 5,
      abortSignal: AbortSignal.timeout(90000),
    }),
  );
  await recordUsage({
    userId,
    feature: "playbook_step",
    provider: resolved.provider,
    model: resolved.modelId,
    tokensIn: result.usage.promptTokens ?? 0,
    tokensOut: result.usage.completionTokens ?? 0,
  });
  return result.text || "step completed";
}

async function updateRun(runId: string, patch: Partial<{ status: string; stepLog: StepLogEntry[]; finishedAt: Date }>) {
  await getDb().update(playbookRuns).set(patch).where(eq(playbookRuns.id, runId));
}

/** Processes steps from where the run left off. */
async function processRun(userId: string, runId: string) {
  const db = getDb();
  const [run] = await db.select().from(playbookRuns).where(and(eq(playbookRuns.id, runId), eq(playbookRuns.userId, userId))).limit(1);
  if (!run) return;
  const stepLog = (run.stepLog as StepLogEntry[]) ?? [];

  for (const entry of stepLog) {
    if (entry.status !== "pending") continue;
    if (await isGloballyPaused()) {
      await updateRun(runId, { status: "paused", stepLog });
      return;
    }
    if (entry.mode === "ask_first") {
      const approval = await createApproval({
        userId,
        kind: "playbook.step",
        title: `Playbook step: ${entry.instruction.slice(0, 120)}`,
        summary: "This step is flagged ask first. Approving runs it.",
        payload: { runId, stepId: entry.stepId, instruction: entry.instruction },
      });
      entry.status = "waiting_approval";
      entry.approvalId = approval.id;
      await updateRun(runId, { status: "waiting_approval", stepLog });
      return;
    }
    try {
      entry.resultSummary = (await executeStepInstruction(userId, entry.instruction)).slice(0, 500);
      entry.status = "done";
    } catch (err) {
      entry.status = "failed";
      entry.resultSummary = (err as Error).message.slice(0, 300);
      await updateRun(runId, { status: "failed", stepLog, finishedAt: new Date() });
      return;
    }
    await updateRun(runId, { stepLog });
  }

  await updateRun(runId, { status: "completed", stepLog, finishedAt: new Date() });
  await createNotification(userId, {
    type: "playbook.done",
    title: "Playbook run finished",
    body: `${stepLog.filter((s) => s.status === "done").length} of ${stepLog.length} steps done.`,
    href: "/playbooks",
  }).catch(() => {});
}

export async function startPlaybookRun(userId: string, playbookId: string) {
  if (await isGloballyPaused()) throw new Error("the platform is paused");
  const db = getDb();
  const [pb] = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, playbookId), eq(playbooks.userId, userId)))
    .limit(1);
  if (!pb) return null;
  const steps = await db
    .select()
    .from(playbookSteps)
    .where(and(eq(playbookSteps.playbookId, playbookId), eq(playbookSteps.userId, userId)))
    .orderBy(asc(playbookSteps.position));
  if (steps.length === 0) throw new Error("this playbook has no steps");

  const stepLog: StepLogEntry[] = steps.map((s) => ({
    stepId: s.id,
    position: s.position,
    instruction: s.instruction,
    mode: s.mode,
    status: "pending",
  }));
  const [run] = await db
    .insert(playbookRuns)
    .values({ userId, playbookId, status: "running", stepLog })
    .returning();

  // fire and continue; the run advances until done or an ask_first wait
  processRun(userId, run.id).catch((err) =>
    getLogger().error({ err: (err as Error).message }, "playbook run crashed"),
  );
  return run;
}

/** Approving an ask_first step executes it and resumes the run. */
registerApprovalExecutor("playbook.step", async (userId, payload) => {
  const p = payload as { runId: string; stepId: string; instruction: string };
  const db = getDb();
  const [run] = await db
    .select()
    .from(playbookRuns)
    .where(and(eq(playbookRuns.id, p.runId), eq(playbookRuns.userId, userId)))
    .limit(1);
  if (!run) throw new Error("playbook run no longer exists");
  const stepLog = (run.stepLog as StepLogEntry[]) ?? [];
  const entry = stepLog.find((s) => s.stepId === p.stepId);
  if (!entry) throw new Error("step not found in the run");

  try {
    entry.resultSummary = (await executeStepInstruction(userId, p.instruction)).slice(0, 500);
    entry.status = "done";
  } catch (err) {
    entry.status = "failed";
    entry.resultSummary = (err as Error).message.slice(0, 300);
    await updateRun(p.runId, { status: "failed", stepLog, finishedAt: new Date() });
    throw err;
  }
  await updateRun(p.runId, { status: "running", stepLog });
  processRun(userId, p.runId).catch(() => {});
  return { summary: `step approved and executed: ${entry.resultSummary.slice(0, 120)}` };
});
