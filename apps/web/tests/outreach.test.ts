import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * Outreach sending fallback and portfolio link tracking: with no
 * mailbox connected a send becomes a copy-ready draft, links in the
 * body are wrapped in tracked redirects, and a click is logged.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required, use scripts/run-tests.sh");
process.env.DATABASE_URL = url;
process.env.VAULT_MASTER_KEY = randomBytes(32).toString("hex");
process.env.SESSION_SECRET = randomBytes(16).toString("hex");
process.env.APP_URL = "https://career.tessconsole.cloud";
process.env.MEILI_HOST = "";

let cleanup: (() => Promise<void>) | undefined;
let userId: string;
let jobId: string;

beforeAll(async () => {
  const { runMigrations } = await import("@tessportal/db/migrate");
  await runMigrations(url!);
  const { createDb, schema } = await import("@tessportal/db");
  const handle = createDb(url!, { max: 3 });
  cleanup = async () => {
    await handle.client.end({ timeout: 5 });
  };
  const [u] = await handle.db.insert(schema.users).values({ email: "out@test.local", name: "Out", passwordHash: "x" }).returning();
  userId = u.id;
  const [job] = await handle.db.insert(schema.jobs).values({ userId, title: "Engineer", companyName: "Co" }).returning();
  jobId = job.id;
});

afterAll(async () => {
  const { getRedis } = await import("../lib/server/health");
  await getRedis().quit().catch(() => {});
  await cleanup?.();
});

describe("outreach send with no mailbox", () => {
  it("stores a copy-ready draft and wraps links in tracked redirects", async () => {
    const { executeOutreachSend, recordLinkClick } = await import("../lib/server/outreach");
    const result = await executeOutreachSend(userId, {
      toEmail: "manager@company.com",
      subject: "Hello",
      body: "Here is my portfolio: https://emma.example.com/work and my github https://github.com/emma",
      jobId,
    });
    expect(result.sent).toBe(false);
    expect(result.summary).toMatch(/copy-ready draft/);

    const { getDb } = await import("../lib/server/db");
    const { schema } = await import("@tessportal/db");
    const { eq, and } = await import("drizzle-orm");
    const [msg] = await getDb().select().from(schema.outreachMessages).where(eq(schema.outreachMessages.id, result.messageId));
    expect(msg.status).toBe("approved_draft");
    // both links were rewritten to tracked redirects
    expect(msg.body).toContain("/r/");
    expect(msg.body).not.toContain("emma.example.com/work");

    // two link_clicks rows exist for this job, click one and see it logged
    const links = await getDb().select().from(schema.linkClicks).where(and(eq(schema.linkClicks.userId, userId), eq(schema.linkClicks.jobId, jobId)));
    expect(links.length).toBe(2);
    const target = await recordLinkClick(links[0].token);
    expect(target).toBe(links[0].url);
    const [after] = await getDb().select().from(schema.linkClicks).where(eq(schema.linkClicks.id, links[0].id));
    expect(after.clickCount).toBe(1);
    expect(after.clickedAt).not.toBeNull();
  });
});
