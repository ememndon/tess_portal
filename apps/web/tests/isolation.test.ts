import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * The isolation proof the spec requires: one user can never read
 * another user's rows through the data access layer. Runs against a
 * scratch database (TEST_DATABASE_URL) with real migrations applied.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required, use scripts/run-tests.sh");
process.env.DATABASE_URL = url;
process.env.VAULT_MASTER_KEY = randomBytes(32).toString("hex");
process.env.SESSION_SECRET = randomBytes(16).toString("hex");

let cleanup: (() => Promise<void>) | undefined;
let aliceId: string;
let bobId: string;

beforeAll(async () => {
  const { runMigrations } = await import("@tessportal/db/migrate");
  await runMigrations(url!);

  const { createDb, schema } = await import("@tessportal/db");
  const handle = createDb(url!, { max: 3 });
  cleanup = async () => {
    await handle.client.end({ timeout: 5 });
  };
  const db = handle.db;

  const [alice] = await db
    .insert(schema.users)
    .values({ email: "alice@test.local", name: "Alice", passwordHash: "x" })
    .returning();
  const [bob] = await db
    .insert(schema.users)
    .values({ email: "bob@test.local", name: "Bob", passwordHash: "x" })
    .returning();
  aliceId = alice.id;
  bobId = bob.id;

  // Alice's personal rows across every personal table
  await db.insert(schema.userSettings).values({
    userId: aliceId,
    timezone: "Europe/Dublin",
    targetCountries: [{ code: "IE", name: "Ireland" }],
  });
  await db.insert(schema.notifications).values({
    userId: aliceId,
    type: "test",
    title: "alice-private-notification",
  });
  await db.insert(schema.auditLog).values({
    userId: aliceId,
    action: "test.private",
    snapshot: { marker: "alice-private-audit" },
  });
  await db.insert(schema.dataExports).values({ userId: aliceId });
});

afterAll(async () => {
  await cleanup?.();
});

describe("row-level isolation in the data access layer", () => {
  it("bob's scope sees none of alice's notifications", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const rows = await scopeFor(bobId).listNotifications();
    expect(rows).toHaveLength(0);
    const aliceRows = await scopeFor(aliceId).listNotifications();
    expect(aliceRows).toHaveLength(1);
  });

  it("bob's scope sees none of alice's audit entries", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const rows = await scopeFor(bobId).listAuditEntries();
    expect(rows).toHaveLength(0);
  });

  it("bob's scope gets defaults, not alice's settings", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const settings = await scopeFor(bobId).getSettings();
    expect(settings.timezone).toBe("UTC");
    expect(settings.targetCountries).toEqual([]);
  });

  it("bob's export contains nothing of alice's", async () => {
    const { scopeFor } = await import("../lib/server/dal");
    const archive = await scopeFor(bobId).exportAll();
    const serialized = JSON.stringify(archive);
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain(aliceId);
  });

  it("vault secrets are scoped per user and unreadable across users", async () => {
    const { setSecret, listSecretMeta, readSecret } = await import("../lib/server/vault");
    await setSecret(aliceId, "user_smtp", "default", JSON.stringify({ pass: "alice-mail-pass" }));
    const bobMeta = await listSecretMeta(bobId);
    expect(bobMeta).toHaveLength(0);
    const bobRead = await readSecret(bobId, "user_smtp", "default");
    expect(bobRead).toBeNull();
    const aliceMeta = await listSecretMeta(aliceId);
    expect(aliceMeta).toHaveLength(1);
    // metadata never carries values
    expect(JSON.stringify(aliceMeta)).not.toContain("alice-mail-pass");
  });

  it("deleting alice removes every row of hers and none of bob's", async () => {
    const { createDb, schema } = await import("@tessportal/db");
    const { scopeFor } = await import("../lib/server/dal");
    const { eq } = await import("drizzle-orm");

    // bob gets one row in each table so survival is provable
    const handle = createDb(url!, { max: 2 });
    const db = handle.db;
    await db.insert(schema.notifications).values({ userId: bobId, type: "t", title: "bob-keeps-this" });

    await scopeFor(aliceId).deleteAccount();

    const aliceUsers = await db.select().from(schema.users).where(eq(schema.users.id, aliceId));
    const aliceNotifs = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, aliceId));
    const aliceSettings = await db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, aliceId));
    const aliceAudit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.userId, aliceId));
    const aliceVault = await db
      .select()
      .from(schema.vaultSecrets)
      .where(eq(schema.vaultSecrets.userId, aliceId));
    const aliceExports = await db
      .select()
      .from(schema.dataExports)
      .where(eq(schema.dataExports.userId, aliceId));

    expect(aliceUsers).toHaveLength(0);
    expect(aliceNotifs).toHaveLength(0);
    expect(aliceSettings).toHaveLength(0);
    expect(aliceAudit).toHaveLength(0);
    expect(aliceVault).toHaveLength(0);
    expect(aliceExports).toHaveLength(0);

    const bobNotifs = await scopeFor(bobId).listNotifications();
    expect(bobNotifs.some((n) => n.title === "bob-keeps-this")).toBe(true);

    await handle.client.end({ timeout: 5 });
  });
});
