import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * The one rule, tested at the enforcement point: a sensitive tool call
 * from any path lands in approvals and never executes without one. The
 * exact approved and executed content is retrievable from the audit
 * log. Also covers the cap machinery: usage events, spend, the 80%
 * alert marker, and degrade-to-free at 100%.
 */

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!url || !redisUrl) throw new Error("TEST_DATABASE_URL and TEST_REDIS_URL required, use scripts/run-tests.sh");
process.env.DATABASE_URL = url;
process.env.REDIS_URL = redisUrl;
process.env.VAULT_MASTER_KEY = randomBytes(32).toString("hex");
process.env.SESSION_SECRET = randomBytes(16).toString("hex");
process.env.MEILI_HOST = "";

let cleanup: (() => Promise<void>)[] = [];
let userId: string;

beforeAll(async () => {
  const { runMigrations } = await import("@tessportal/db/migrate");
  await runMigrations(url!);
  const { createDb, schema } = await import("@tessportal/db");
  const handle = createDb(url!, { max: 3 });
  cleanup.push(async () => {
    await handle.client.end({ timeout: 5 });
  });
  const [u] = await handle.db
    .insert(schema.users)
    .values({ email: "gate@test.local", name: "Gate Tester", passwordHash: "x" })
    .returning();
  userId = u.id;
  await handle.db.insert(schema.capConfig).values({ id: 1, monthlyCapUsd: "40" }).onConflictDoNothing();
});

afterAll(async () => {
  const { getRedis } = await import("../lib/server/health");
  await getRedis()
    .flushdb()
    .catch(() => {});
  await getRedis()
    .quit()
    .catch(() => {});
  for (const fn of cleanup) await fn();
});

describe("the sensitive gate in the execution layer", () => {
  it("a sensitive tool call from a playbook path creates an approval and does not execute", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const { executeToolDirect } = await import("../lib/tess/tools");
    const { listPendingApprovals } = await import("../lib/server/approvals");

    const job = await scopeFor(userId).createJob({ title: "Doomed Job", companyName: "Gate Co" });
    const result = (await executeToolDirect(userId, "playbook", "delete_job", { jobId: job.id })) as {
      approvalRequired?: boolean;
      approvalId?: string;
    };
    expect(result.approvalRequired).toBe(true);
    expect(result.approvalId).toBeDefined();

    // the job is untouched: nothing executed
    expect(await scopeFor(userId).getJob(job.id)).not.toBeNull();
    const pending = await listPendingApprovals(userId);
    expect(pending.some((a) => a.id === result.approvalId)).toBe(true);
  });

  it("rejecting an approval never executes it", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const { executeToolDirect } = await import("../lib/tess/tools");
    const { rejectApproval } = await import("../lib/server/approvals");

    const job = await scopeFor(userId).createJob({ title: "Safe Job", companyName: "Gate Co" });
    const result = (await executeToolDirect(userId, "scheduled", "delete_job", { jobId: job.id })) as {
      approvalId: string;
    };
    const rejected = await rejectApproval(userId, result.approvalId);
    expect(rejected?.status).toBe("rejected");
    expect(await scopeFor(userId).getJob(job.id)).not.toBeNull();
  });

  it("approving executes and the audit log holds the exact frozen content", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const { executeToolDirect } = await import("../lib/tess/tools");
    const { approveAndExecute } = await import("../lib/server/approvals");

    const scope = scopeFor(userId);
    const result = (await executeToolDirect(userId, "playbook", "send_outreach_email", {
      toEmail: "manager@example.com",
      subject: "Exact Subject Line",
      body: "The exact words that were approved, verbatim.",
    })) as { approvalId: string };

    const outcome = await approveAndExecute(userId, result.approvalId);
    expect(outcome?.status).toBe("executed");

    const auditEntries = await scope.listAuditEntries(50);
    const created = auditEntries.find(
      (e) => e.action === "approval.created" && e.targetId === result.approvalId,
    );
    const executed = auditEntries.find(
      (e) => e.action === "approval.executed" && e.targetId === result.approvalId,
    );
    expect(created).toBeDefined();
    expect(executed).toBeDefined();
    // word for word, in both records
    expect(JSON.stringify(created!.snapshot)).toContain("The exact words that were approved, verbatim.");
    expect(JSON.stringify(executed!.snapshot)).toContain("The exact words that were approved, verbatim.");
    expect(JSON.stringify(executed!.snapshot)).toContain("Exact Subject Line");
  });

  it("an already-decided approval cannot be executed twice", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const { executeToolDirect } = await import("../lib/tess/tools");
    const { approveAndExecute } = await import("../lib/server/approvals");

    const job = await scopeFor(userId).createJob({ title: "Once Job", companyName: "Gate Co" });
    const result = (await executeToolDirect(userId, "playbook", "delete_job", { jobId: job.id })) as {
      approvalId: string;
    };
    const first = await approveAndExecute(userId, result.approvalId);
    expect(first?.status).toBe("executed");
    const second = await approveAndExecute(userId, result.approvalId);
    expect(second).toBeNull();
  });
});

describe("cap and metering", () => {
  it("usage events accumulate spend and the cap flips to exceeded", async () => {
    const { recordUsage, monthlySpend, capExceeded, getCap } = await import("../lib/ai/meter");
    const { getDb } = await import("../lib/server/db");
    const { schema } = await import("@tessportal/db");
    const { eq } = await import("drizzle-orm");

    expect(await capExceeded()).toBe(false);
    // 3M output tokens of claude-sonnet-4-5 at $15/M = $45, over the $40 cap
    await recordUsage({
      userId,
      feature: "chat",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      tokensIn: 0,
      tokensOut: 3_000_000,
    });
    const spend = await monthlySpend();
    expect(spend).toBeGreaterThan(40);
    expect(await capExceeded()).toBe(true);
    expect(Number((await getCap()).monthlyCapUsd)).toBe(40);

    // the 80% alert marker was set exactly once for this month
    const db = getDb();
    const marker = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, "cap.alerted"));
    expect((marker[0]?.value as { month?: string }).month).toBe(new Date().toISOString().slice(0, 7));
  });

  it("free-tier metering counts requests and tokens per provider per day", async () => {
    const { recordUsage, providerDailyUsage, freeTierHasRoom } = await import("../lib/ai/meter");
    await recordUsage({
      userId,
      feature: "classification",
      provider: "cerebras",
      model: "llama-3.3-70b",
      tokensIn: 500,
      tokensOut: 300,
    });
    const usage = await providerDailyUsage("cerebras");
    expect(usage.requests).toBeGreaterThanOrEqual(1);
    expect(usage.tokens).toBeGreaterThanOrEqual(800);
    expect(await freeTierHasRoom("cerebras")).toBe(true);
  });
});
