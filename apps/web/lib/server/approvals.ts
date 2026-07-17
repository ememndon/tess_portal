import { and, desc, eq } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { getDb } from "./db";
import { audit } from "./audit";
import { createNotification } from "./notify";
import { getLogger } from "./health";

const { approvals } = schema;

/**
 * The approval queue. Sensitive actions are created here as records
 * with a frozen payload snapshot and only execute on explicit user
 * approval. Executors are registered per kind; the gate itself lives
 * in the tool execution layer, which routes every sensitive tool call
 * into createApproval instead of running it.
 */

export type ApprovalExecutor = (
  userId: string,
  payload: Record<string, unknown>,
) => Promise<{ summary: string }>;

const executors = new Map<string, ApprovalExecutor>();

export function registerApprovalExecutor(kind: string, executor: ApprovalExecutor) {
  executors.set(kind, executor);
}

export async function createApproval(input: {
  userId: string;
  kind: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
}) {
  const db = getDb();
  const [approval] = await db
    .insert(approvals)
    .values({
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      payload: input.payload,
    })
    .returning();
  await createNotification(input.userId, {
    type: "approval",
    title: `Waiting for you: ${input.title}`,
    body: input.summary,
    href: "/notifications",
  }).catch(() => {});
  // the frozen snapshot of exactly what was proposed
  await audit({
    userId: input.userId,
    action: "approval.created",
    targetType: "approval",
    targetId: approval.id,
    snapshot: { kind: input.kind, title: input.title, payload: input.payload },
  });
  return approval;
}

export async function listPendingApprovals(userId: string) {
  return getDb()
    .select()
    .from(approvals)
    .where(and(eq(approvals.userId, userId), eq(approvals.status, "pending")))
    .orderBy(desc(approvals.createdAt));
}

export async function getApproval(userId: string, id: string) {
  const rows = await getDb()
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, id), eq(approvals.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function rejectApproval(userId: string, id: string, ip?: string) {
  const db = getDb();
  const [row] = await db
    .update(approvals)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(and(eq(approvals.id, id), eq(approvals.userId, userId), eq(approvals.status, "pending")))
    .returning();
  if (!row) return null;
  await audit({
    userId,
    action: "approval.rejected",
    targetType: "approval",
    targetId: id,
    snapshot: { kind: row.kind, title: row.title, payload: row.payload },
    ip,
  });
  return row;
}

/**
 * Approves and executes. The audit trail stores exactly what was
 * approved and exactly what was done, word for word.
 */
export async function approveAndExecute(userId: string, id: string, ip?: string) {
  const db = getDb();
  const [row] = await db
    .update(approvals)
    .set({ status: "approved", decidedAt: new Date() })
    .where(and(eq(approvals.id, id), eq(approvals.userId, userId), eq(approvals.status, "pending")))
    .returning();
  if (!row) return null;
  await audit({
    userId,
    action: "approval.approved",
    targetType: "approval",
    targetId: id,
    snapshot: { kind: row.kind, title: row.title, payload: row.payload },
    ip,
  });

  const executor = executors.get(row.kind);
  if (!executor) {
    await db.update(approvals).set({ status: "failed" }).where(eq(approvals.id, id));
    getLogger().error({ kind: row.kind }, "no executor for approval kind");
    return { ...row, status: "failed", executionSummary: "no executor registered for this action" };
  }
  try {
    const result = await executor(userId, row.payload as Record<string, unknown>);
    await db.update(approvals).set({ status: "executed", executedAt: new Date() }).where(eq(approvals.id, id));
    await audit({
      userId,
      action: "approval.executed",
      targetType: "approval",
      targetId: id,
      snapshot: { kind: row.kind, title: row.title, payload: row.payload, result: result.summary },
      ip,
    });
    return { ...row, status: "executed", executionSummary: result.summary };
  } catch (err) {
    await db.update(approvals).set({ status: "failed" }).where(eq(approvals.id, id));
    await audit({
      userId,
      action: "approval.failed",
      targetType: "approval",
      targetId: id,
      snapshot: { kind: row.kind, error: (err as Error).message.slice(0, 500) },
      ip,
    });
    return { ...row, status: "failed", executionSummary: (err as Error).message.slice(0, 200) };
  }
}
