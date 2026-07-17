import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@tessportal/db";
import { runMigrations } from "@tessportal/db/migrate";
import { matchSponsor, seedSponsors } from "../src/discovery/sponsors";
import { fingerprint, findDuplicate } from "../src/discovery/dedup";
import { purgeOldJobs } from "../src/discovery/tasks";
import type { RawPosting } from "../src/discovery/types";

/**
 * DB-backed discovery tests: sponsor matching against the register,
 * cross-source dedup, and the 60-day purge removing only unsaved jobs.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required, use scripts/run-tests.sh");

let handle: ReturnType<typeof createDb>;
let userId: string;

beforeAll(async () => {
  await runMigrations(url!);
  handle = createDb(url!, { max: 3 });
  await seedSponsors(handle.db);
  const [u] = await handle.db
    .insert(schema.users)
    .values({ email: "disco@test.local", name: "Disco", passwordHash: "x" })
    .returning();
  userId = u.id;
});

afterAll(async () => {
  await handle.client.end({ timeout: 5 });
});

describe("sponsor matching", () => {
  it("flags a known register company in the Netherlands", async () => {
    const m = await matchSponsor(handle.db, "Adyen N.V.", "NL");
    expect(m.status).toBe("confirmed");
    expect(m.matchedName).toBe("Adyen");
  });

  it("flags a known Irish sponsor with a suffix", async () => {
    const m = await matchSponsor(handle.db, "Stripe Payments Ireland", "IE");
    expect(m.status).toBe("confirmed");
  });

  it("does not falsely confirm an unknown company", async () => {
    const m = await matchSponsor(handle.db, "Totally Made Up Widgets Ltd", "NL");
    expect(m.status).toBe("unknown");
  });

  it("returns unknown for countries without a register", async () => {
    const m = await matchSponsor(handle.db, "Adyen", "US");
    expect(m.status).toBe("unknown");
  });
});

describe("cross-source dedup", () => {
  it("detects the same role from a second source by fingerprint", async () => {
    const first: RawPosting = {
      externalId: "gh:acme:1",
      title: "Senior Platform Engineer",
      companyName: "Acme Corp",
      location: "Dublin, Ireland",
      countryCode: "IE",
      remote: null,
      url: "https://a",
      description: "",
      salaryRaw: null,
      postedAt: new Date(),
      source: "greenhouse",
      market: "EUR",
    };
    const fp = fingerprint(first);
    await handle.db.insert(schema.jobs).values({
      userId,
      title: first.title,
      companyName: first.companyName,
      countryCode: "IE",
      source: "greenhouse",
      saved: false,
      externalId: first.externalId,
      fingerprint: fp,
    });

    // same role, different source and URL and a seniority tweak
    const second: RawPosting = { ...first, externalId: "lever:acme:9", title: "Platform Engineer", url: "https://b", source: "lever" };
    const dup = await findDuplicate(handle.db, userId, second, fingerprint(second), null);
    expect(dup).not.toBeNull();
  });

  it("does not flag a genuinely different role as a duplicate", async () => {
    const other: RawPosting = {
      externalId: "gh:acme:2",
      title: "Marketing Manager",
      companyName: "Acme Corp",
      location: "Dublin",
      countryCode: "IE",
      remote: null,
      url: "https://c",
      description: "",
      salaryRaw: null,
      postedAt: new Date(),
      source: "greenhouse",
      market: "EUR",
    };
    const dup = await findDuplicate(handle.db, userId, other, fingerprint(other), null);
    expect(dup).toBeNull();
  });
});

describe("60-day purge", () => {
  it("removes only unsaved jobs older than 60 days", async () => {
    const old = new Date(Date.now() - 61 * 24 * 3600 * 1000);
    const recent = new Date();
    await handle.db.insert(schema.jobs).values([
      { userId, title: "Old Unsaved", companyName: "X", saved: false, createdAt: old },
      { userId, title: "Old Saved", companyName: "X", saved: true, createdAt: old },
      { userId, title: "Recent Unsaved", companyName: "X", saved: false, createdAt: recent },
    ]);
    const result = await purgeOldJobs(handle.db);
    expect(result).toMatch(/purged \d+ unsaved/);

    const remaining = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.userId, userId));
    const titles = remaining.map((r) => r.title);
    expect(titles).not.toContain("Old Unsaved");
    expect(titles).toContain("Old Saved");
    expect(titles).toContain("Recent Unsaved");
  });
});
