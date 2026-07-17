import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * Phase 2 acceptance in test form: a job moves through all eight
 * stages with every change on its timeline, the snapshot is permanent,
 * and none of the new personal tables leak across users.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required, use scripts/run-tests.sh");
process.env.DATABASE_URL = url;
process.env.VAULT_MASTER_KEY = randomBytes(32).toString("hex");
process.env.SESSION_SECRET = randomBytes(16).toString("hex");
process.env.MEILI_HOST = ""; // search sync is best-effort and silently skipped in tests

let cleanup: (() => Promise<void>) | undefined;
let carolId: string;
let daveId: string;

beforeAll(async () => {
  const { runMigrations } = await import("@tessportal/db/migrate");
  await runMigrations(url!);
  const { createDb, schema } = await import("@tessportal/db");
  const handle = createDb(url!, { max: 3 });
  cleanup = async () => handle.client.end({ timeout: 5 }).then(() => {});
  const [carol] = await handle.db
    .insert(schema.users)
    .values({ email: "carol@test.local", name: "Carol", passwordHash: "x" })
    .returning();
  const [dave] = await handle.db
    .insert(schema.users)
    .values({ email: "dave@test.local", name: "Dave", passwordHash: "x" })
    .returning();
  carolId = carol.id;
  daveId = dave.id;
});

afterAll(async () => {
  await cleanup?.();
});

describe("pipeline lifecycle", () => {
  it("moves a job through all eight stages with a full timeline", async () => {
    const { scopeFor, JOB_STAGES } = await import("../lib/server/dal");
    const scope = scopeFor(carolId);
    const job = await scope.createJob({
      title: "Full-Stack Developer",
      companyName: "Veldkamp Software",
      location: "Amsterdam, NL",
      url: "https://example.com/job",
      description: "Original posting text that must survive.",
      source: "manual",
    });
    expect(job.stage).toBe("saved");

    for (const stage of JOB_STAGES.slice(1)) {
      const moved = await scope.moveJobStage(job.id, stage);
      expect(moved?.stage).toBe(stage);
    }
    await scope.addJobNote(job.id, "spoke to the recruiter");

    const activities = await scope.listJobActivities(job.id);
    const stageChanges = activities.filter((a) => a.type === "stage_changed");
    expect(stageChanges).toHaveLength(JOB_STAGES.length - 1);
    expect(activities.some((a) => a.type === "created")).toBe(true);
    expect(activities.some((a) => a.type === "note")).toBe(true);
    // the timeline records every from → to pair in order
    const pairs = stageChanges
      .reverse()
      .map((a) => `${(a.payload as { from: string }).from}>${(a.payload as { to: string }).to}`);
    expect(pairs[0]).toBe("saved>researching");
    expect(pairs.at(-1)).toBe("rejected>ghosted");
  });

  it("keeps the snapshot even when the job description is wiped", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const scope = scopeFor(carolId);
    const job = await scope.createJob({
      title: "Snapshot Job",
      companyName: "Vanishing Postings Ltd",
      description: "The posting content that later disappears from the web.",
      url: "https://gone.example.com/404",
    });
    // simulate the original URL content dying: the live record changes
    await scope.updateJob(job.id, { description: null, url: null });
    const snapshot = await scope.getJobSnapshot(job.id);
    expect(snapshot).not.toBeNull();
    expect(JSON.stringify(snapshot!.content)).toContain("later disappears");
  });

  it("interview creation instantly lands on the calendar with reminders", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const scope = scopeFor(carolId);
    const job = await scope.createJob({ title: "Cal Job", companyName: "Cal Co" });
    const when = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const interview = await scope.createInterview({
      jobId: job.id,
      round: "Round 1",
      medium: "video",
      scheduledAt: when,
      durationMin: 45,
      reminderLeadMinutes: [1440, 30],
    });
    expect(interview).not.toBeNull();
    const events = await scope.listAllCalendarEvents();
    const event = events.find((e) => e.sourceType === "interview" && e.sourceId === interview!.id);
    expect(event).toBeDefined();
    expect(event!.startsAt.getTime()).toBe(when.getTime());
    expect(event!.endsAt!.getTime()).toBe(when.getTime() + 45 * 60000);
  });
});

describe("phase 2 isolation", () => {
  it("dave sees none of carol's jobs, documents, events, or contacts", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const carol = scopeFor(carolId);
    await carol.createContact({ name: "Carol Contact" });
    await carol.createDocument({
      kind: "cv_base",
      title: "Carol CV",
      fileName: "carol.pdf",
      mime: "application/pdf",
      contentBase64: Buffer.from("carol-private-bytes").toString("base64"),
    });

    const dave = scopeFor(daveId);
    expect(await dave.listJobs()).toHaveLength(0);
    expect(await dave.listContacts()).toHaveLength(0);
    expect(await dave.listDocuments()).toHaveLength(0);
    expect(await dave.listInterviews()).toHaveLength(0);
    expect(await dave.listAllCalendarEvents()).toHaveLength(0);
    const archive = JSON.stringify(await dave.exportAll());
    expect(archive).not.toContain("carol");
    expect(archive).not.toContain(carolId);
  });

  it("dave cannot touch carol's job through the DAL", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const carolJobs = await scopeFor(carolId).listJobs();
    const target = carolJobs[0];
    const dave = scopeFor(daveId);
    expect(await dave.getJob(target.id)).toBeNull();
    expect(await dave.moveJobStage(target.id, "rejected")).toBeNull();
    expect(await dave.addJobNote(target.id, "intrusion")).toBeNull();
    expect(await dave.deleteJob(target.id)).toBe(false);
    // carol's job is untouched
    const stillThere = await scopeFor(carolId).getJob(target.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.stage).toBe(target.stage);
  });
});
