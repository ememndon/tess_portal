import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@tessportal/db";
import { runMigrations } from "@tessportal/db/migrate";
import { classifyEmail, processIncoming } from "../src/inbox";
import type { IncomingEmail } from "../src/inbox";

/**
 * Inbox classification and the incoming-email pipeline: a rejection
 * moves the job and notifies, an interview invite drafts a reply into
 * approvals, and any reply stops an active sequence.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required, use scripts/run-tests.sh");

const redis = { publish: async () => 0 } as never;
const log = { info() {}, warn() {}, error() {} } as never;

let handle: ReturnType<typeof createDb>;
let userId: string;
let jobId: string;
let contactId: string;
let sequenceId: string;

const MANAGER = "manager@ardenlabs.example.com";

beforeAll(async () => {
  await runMigrations(url!);
  handle = createDb(url!, { max: 3 });
  const db = handle.db;
  const [u] = await db.insert(schema.users).values({ email: "inbox@test.local", name: "Inbox", passwordHash: "x" }).returning();
  userId = u.id;
  const [job] = await db.insert(schema.jobs).values({ userId, title: "Platform Engineer", companyName: "Arden Labs", stage: "outreach" }).returning();
  jobId = job.id;
  const [contact] = await db.insert(schema.contacts).values({ userId, name: "A Manager", email: MANAGER }).returning();
  contactId = contact.id;
  const [seq] = await db
    .insert(schema.outreachSequences)
    .values({ userId, jobId, contactId, name: "Arden outreach", status: "active" })
    .returning();
  sequenceId = seq.id;
  // an outbound message so incoming replies match to this job and contact
  await db.insert(schema.outreachMessages).values({
    userId,
    jobId,
    contactId,
    direction: "out",
    body: "Hello",
    toEmail: MANAGER,
    status: "sent",
  });
});

afterAll(async () => {
  await handle.client.end({ timeout: 5 });
});

describe("email classification", () => {
  it("classifies a rejection", () => {
    expect(classifyEmail("Update on your application", "Unfortunately we have decided not to move forward.")).toBe("rejection");
  });
  it("classifies an interview invite", () => {
    expect(classifyEmail("Next steps", "We would love to schedule a call. What is your availability?")).toBe("interview");
  });
  it("classifies a plain reply", () => {
    expect(classifyEmail("Re: hello", "Thanks for reaching out, I will take a look.")).toBe("reply");
  });
});

describe("incoming email pipeline", () => {
  const mk = (subject: string, text: string, id: string): IncomingEmail => ({
    externalId: id,
    fromEmail: MANAGER,
    subject,
    text,
    date: new Date(),
  });

  it("a reply stops the active sequence", async () => {
    const res = await processIncoming(handle.db, redis, log, userId, mk("Re: hello", "Thanks, I will review.", "msg-reply-1"));
    expect(res?.classification).toBe("reply");
    const [seq] = await handle.db.select().from(schema.outreachSequences).where(eq(schema.outreachSequences.id, sequenceId));
    expect(seq.status).toBe("stopped:reply");
  });

  it("an interview invite drafts an approval and moves the job to interview", async () => {
    const res = await processIncoming(handle.db, redis, log, userId, mk("Next steps", "Can we schedule a call? Your availability?", "msg-interview-1"));
    expect(res?.classification).toBe("interview");
    const approvals = await handle.db.select().from(schema.approvals).where(eq(schema.approvals.userId, userId));
    expect(approvals.some((a) => a.kind === "outreach.send" && a.title.includes("interview invite"))).toBe(true);
    const [job] = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.stage).toBe("interview");
  });

  it("a rejection moves the job to rejected and notifies", async () => {
    // reset stage so the move is observable
    await handle.db.update(schema.jobs).set({ stage: "applied" }).where(eq(schema.jobs.id, jobId));
    const res = await processIncoming(handle.db, redis, log, userId, mk("Application update", "Unfortunately you were unsuccessful this time.", "msg-reject-1"));
    expect(res?.classification).toBe("rejection");
    expect(res?.action).toBe("moved_to_rejected");
    const [job] = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.stage).toBe("rejected");
    const notifs = await handle.db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
    expect(notifs.some((n) => n.type === "inbox.rejection")).toBe(true);
  });

  it("dedupes an already-processed message", async () => {
    const dupe = await processIncoming(handle.db, redis, log, userId, mk("Re: hello", "again", "msg-reply-1"));
    expect(dupe).toBeNull();
  });
});
