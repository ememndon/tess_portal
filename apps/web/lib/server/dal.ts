import { and, asc, desc, eq, gt, inArray, isNull, isNotNull, lt, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import { getDb } from "./db";
import { removeSearchDoc, removeUserFromSearch, syncSearchDoc } from "./search";

const {
  users,
  userSettings,
  notifications,
  auditLog,
  dataExports,
  vaultSecrets,
  invites,
  sessions,
  jobs,
  jobSnapshots,
  jobActivities,
  companies,
  companyWatchlist,
  contacts,
  documents,
  documentVersions,
  applications,
  interviews,
  offers,
  calendarEvents,
  reminders,
  standingInstructions,
  learnedProfile,
  outreachMessages,
  outreachSequences,
  sequenceSteps,
  linkClicks,
  conversations,
  messages: messagesTable,
  profiles,
  workSamples,
  signals,
  prepPacks,
  storyBank,
  mailAccounts,
  mailFolders,
  mailThreads,
  mailMessages,
  mailAttachments,
  mailOutbox,
  mailContacts,
  mailUploads,
  mailDrafts,
  mailRules,
} = schema;

/** Parses Gmail-style search operators out of a query string. */
export function parseMailSearch(raw: string): {
  text: string;
  from?: string;
  to?: string;
  subject?: string;
  isUnread?: boolean;
  isStarred?: boolean;
  hasAttachment?: boolean;
  before?: Date;
  after?: Date;
} {
  const out: ReturnType<typeof parseMailSearch> = { text: "" };
  const words: string[] = [];
  for (const tok of raw.split(/\s+/)) {
    const m = tok.match(/^(from|to|subject|is|has|before|after):(.+)$/i);
    if (!m) {
      if (tok) words.push(tok);
      continue;
    }
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === "from") out.from = val.toLowerCase();
    else if (key === "to") out.to = val.toLowerCase();
    else if (key === "subject") out.subject = val;
    else if (key === "is" && val.toLowerCase() === "unread") out.isUnread = true;
    else if (key === "is" && val.toLowerCase() === "starred") out.isStarred = true;
    else if (key === "has" && val.toLowerCase() === "attachment") out.hasAttachment = true;
    else if (key === "before") {
      const d = new Date(val);
      if (!Number.isNaN(d.getTime())) out.before = d;
    } else if (key === "after") {
      const d = new Date(val);
      if (!Number.isNaN(d.getTime())) out.after = d;
    } else words.push(tok);
  }
  out.text = words.join(" ").trim();
  return out;
}

export type TargetCountry = { code: string | null; name: string };

/** The filter/sort state behind the Discover list; shared by the page query and its count. */
export type DiscoverQuery = {
  reveal?: boolean;
  country?: string | null;
  source?: string | null;
  sponsorship?: string | null;
  q?: string | null;
  sort?: string | null;
};

/** Discovered candidates shown per page. */
export const DISCOVER_PAGE_SIZE = 60;

export const JOB_STAGES = schema.JOB_STAGES;
export type JobStage = (typeof JOB_STAGES)[number];

/**
 * The scoped data access layer. Row-level isolation is enforced here:
 * every read and write on a personal table goes through a UserScope,
 * and every query it issues filters by the scope's user id. Route
 * handlers never touch personal tables directly.
 */
export class UserScope {
  constructor(
    private readonly userId: string,
    private readonly db: Db = getDb(),
  ) {}

  get id() {
    return this.userId;
  }

  /* ---------- settings ---------- */

  async getSettings() {
    const rows = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, this.userId))
      .limit(1);
    return (
      rows[0] ?? {
        userId: this.userId,
        timezone: "UTC",
        targetCountries: [] as TargetCountry[],
        roleQuery: null as string | null,
        requireSponsorship: true,
        requireFamilyReunification: true,
        theme: "dark",
        updatedAt: new Date(),
      }
    );
  }

  async updateSettings(patch: {
    timezone?: string;
    targetCountries?: TargetCountry[];
    roleQuery?: string | null;
    requireSponsorship?: boolean;
    requireFamilyReunification?: boolean;
    theme?: string;
  }) {
    await this.db
      .insert(userSettings)
      .values({ userId: this.userId, ...patch })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { ...patch, updatedAt: new Date() },
      });
  }

  async updateName(name: string) {
    await this.db
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, this.userId));
  }

  async markOnboarded() {
    await this.db
      .update(users)
      .set({ onboardedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(users.id, this.userId), isNull(users.onboardedAt)));
  }

  /* ---------- notifications ---------- */

  async listNotifications(limit = 50) {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, this.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async markAllNotificationsRead() {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, this.userId), isNull(notifications.readAt)));
  }

  /* ---------- audit ---------- */

  async listAuditEntries(limit = 100) {
    return this.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.userId, this.userId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
  }

  /* ---------- jobs ---------- */

  private jobSearchDoc(job: typeof jobs.$inferSelect) {
    return {
      id: job.id,
      userId: this.userId,
      title: job.title,
      subtitle: [job.companyName, job.location].filter(Boolean).join(" · "),
      href: `/pipeline/${job.id}`,
      body: job.description?.slice(0, 4000) ?? "",
      stage: job.stage,
      updatedAt: Date.now(),
    };
  }

  /** The pipeline: saved jobs only. Discovered candidates live in Discover. */
  async listJobs() {
    return this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, this.userId), eq(jobs.saved, true)))
      .orderBy(desc(jobs.updatedAt));
  }

  /**
   * The smart-strict sponsorship gate. When a user requires sponsorship
   * (the default), hide candidates in countries that publish a sponsor
   * register (GB/NL/CA/NZ/IE) that carry no sponsorship signal at all.
   * Gulf roles are stored as "inferred" (structural sponsorship) and
   * register-less countries keep "unknown", so neither is hidden. Pass
   * reveal to drop the gate ("show unverified too"). Returns the extra
   * SQL conditions to AND into a discovered-jobs query.
   */
  private async discoverGateConditions(reveal?: boolean) {
    if (reveal) return [];
    const rows = await this.db
      .select({ req: userSettings.requireSponsorship })
      .from(userSettings)
      .where(eq(userSettings.userId, this.userId))
      .limit(1);
    const requireSponsorship = rows[0]?.req ?? true;
    if (!requireSponsorship) return [];
    return [
      // NZ is intentionally NOT here: it publishes no bulk sponsor register, so
      // (like AU) we show its roles rather than hide the ones we can't verify.
      sql`NOT (${jobs.countryCode} IN ('GB','NL','CA','IE') AND ${jobs.sponsorship} = 'unknown')`,
    ];
  }

  /** Filters shared by the discovered-jobs list and its total count, so paging math is exact. */
  private async discoverConditions(opts: DiscoverQuery) {
    const gate = await this.discoverGateConditions(opts.reveal);
    const conds = [
      eq(jobs.userId, this.userId),
      eq(jobs.saved, false),
      isNull(jobs.dismissedAt),
      // hide postings older than a month (unknown post dates are kept)
      sql`(${jobs.postedAt} is null or ${jobs.postedAt} >= now() - interval '30 days')`,
      ...gate,
    ];
    if (opts.country) conds.push(eq(jobs.countryCode, opts.country));
    if (opts.sponsorship) conds.push(eq(jobs.sponsorship, opts.sponsorship));
    if (opts.source) conds.push(sql`split_part(${jobs.source}, ':', 1) = ${opts.source}`);
    if (opts.q && opts.q.trim()) {
      conds.push(sql`(${jobs.title} ilike ${`%${opts.q.trim()}%`} or ${jobs.companyName} ilike ${`%${opts.q.trim()}%`})`);
    }
    return conds;
  }

  /** Discovered candidates: unsaved, not dismissed, fresh (<= 1 month), best first, one page at a time. */
  async listDiscovered(opts: DiscoverQuery & { limit?: number; offset?: number } = {}) {
    const conds = await this.discoverConditions(opts);
    // "recent" sorts newest-posted first (nulls last); default ranks by fit.
    // id breaks ties so a row never straddles two pages as the user pages on.
    const order =
      opts.sort === "recent"
        ? [sql`${jobs.postedAt} desc nulls last`, desc(jobs.matchScore), desc(jobs.id)]
        : [desc(jobs.matchScore), desc(jobs.postedAt), desc(jobs.id)];
    return this.db
      .select()
      .from(jobs)
      .where(and(...conds))
      .orderBy(...order)
      .limit(opts.limit ?? 60)
      .offset(opts.offset ?? 0);
  }

  /** Total discovered candidates matching the current filters (for pagination). */
  async countDiscoveredMatching(opts: DiscoverQuery = {}): Promise<number> {
    const conds = await this.discoverConditions(opts);
    const rows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(jobs)
      .where(and(...conds));
    return Number(rows[0]?.n ?? 0);
  }

  /** Distinct countries and sources present in the user's fresh discovered set (for filter menus). */
  async discoverFacets(): Promise<{ countries: string[]; sources: string[] }> {
    const rows = await this.db
      .select({
        country: jobs.countryCode,
        source: sql<string>`split_part(${jobs.source}, ':', 1)`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, this.userId),
          eq(jobs.saved, false),
          isNull(jobs.dismissedAt),
          sql`(${jobs.postedAt} is null or ${jobs.postedAt} >= now() - interval '30 days')`,
        ),
      );
    const countries = [...new Set(rows.map((r) => r.country).filter((c): c is string => Boolean(c)))].sort();
    const sources = [...new Set(rows.map((r) => r.source).filter(Boolean))].sort();
    return { countries, sources };
  }

  /** Count of discovered candidates hidden by the sponsorship gate right now. */
  async countGatedDiscovered(): Promise<number> {
    const gate = await this.discoverGateConditions(false);
    if (gate.length === 0) return 0;
    const rows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, this.userId),
          eq(jobs.saved, false),
          isNull(jobs.dismissedAt),
          sql`(${jobs.countryCode} IN ('GB','NL','CA','IE') AND ${jobs.sponsorship} = 'unknown')`,
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  async countDiscovered(): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(jobs)
      .where(and(eq(jobs.userId, this.userId), eq(jobs.saved, false), isNull(jobs.dismissedAt)));
    return Number(rows[0]?.n ?? 0);
  }

  async getJob(jobId: string) {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, this.userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Saves a discovered candidate into the pipeline: flips saved, freezes
   * a permanent snapshot, logs the timeline, and indexes for search.
   */
  async saveDiscovered(jobId: string) {
    const job = await this.getJob(jobId);
    if (!job || job.saved) return job ?? null;

    // Auto-watch: saving a job signals interest in its employer, so upsert
    // the company and add it to the monitored watchlist. The overnight
    // watchlist monitor then keeps reading that employer's own board. Never
    // let this bookkeeping block the save itself.
    let companyId: string | null = job.companyId ?? null;
    const companyName = job.companyName?.trim();
    if (companyName) {
      try {
        const company = await this.getOrCreateCompany({
          name: companyName,
          countryCode: job.countryCode ?? undefined,
        });
        companyId = company.id;
        await this.setCompanyWatch(company.id, true);
        await this.createSignal(company.id, "interest", {
          via: "discover_save",
          jobId,
          jobTitle: job.title,
        });
      } catch {
        // ignore: a save must succeed even if watch bookkeeping fails
      }
    }

    await this.db
      .update(jobs)
      .set({
        saved: true,
        stage: "saved",
        companyId: companyId ?? undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, this.userId)));
    await this.db.insert(jobSnapshots).values({
      userId: this.userId,
      jobId,
      content: {
        capturedAt: new Date().toISOString(),
        title: job.title,
        companyName: job.companyName,
        location: job.location,
        url: job.url,
        source: job.source,
        salaryRaw: job.salaryRaw,
        description: job.description,
      },
    });
    await this.db.insert(jobActivities).values({
      userId: this.userId,
      jobId,
      type: "created",
      payload: { stage: "saved", source: job.source, from: "discover" },
    });
    await syncSearchDoc("jobs", this.jobSearchDoc({ ...job, saved: true }));
    return { ...job, saved: true };
  }

  async dismissDiscovered(jobId: string) {
    const [row] = await this.db
      .update(jobs)
      .set({ dismissedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, this.userId), eq(jobs.saved, false)))
      .returning({ id: jobs.id });
    return Boolean(row);
  }

  /** Bulk-dismiss discovered candidates (Discover "dismiss selected"). */
  async dismissDiscoveredBulk(jobIds: string[]) {
    if (jobIds.length === 0) return 0;
    const rows = await this.db
      .update(jobs)
      .set({ dismissedAt: new Date() })
      .where(
        and(inArray(jobs.id, jobIds), eq(jobs.userId, this.userId), eq(jobs.saved, false)),
      )
      .returning({ id: jobs.id });
    return rows.length;
  }

  /** Creates the job, its permanent snapshot, and the first timeline entry. */
  async createJob(input: {
    title: string;
    companyName: string;
    location?: string;
    countryCode?: string;
    url?: string;
    source?: string;
    description?: string;
    salaryRaw?: string;
    sponsorship?: string;
    stage?: JobStage;
  }) {
    const [job] = await this.db
      .insert(jobs)
      .values({ userId: this.userId, ...input })
      .returning();
    await this.db.insert(jobSnapshots).values({
      userId: this.userId,
      jobId: job.id,
      content: {
        capturedAt: new Date().toISOString(),
        title: job.title,
        companyName: job.companyName,
        location: job.location,
        url: job.url,
        source: job.source,
        salaryRaw: job.salaryRaw,
        description: job.description,
      },
    });
    await this.db.insert(jobActivities).values({
      userId: this.userId,
      jobId: job.id,
      type: "created",
      payload: { stage: job.stage, source: job.source },
    });
    await syncSearchDoc("jobs", this.jobSearchDoc(job));
    return job;
  }

  async updateJob(
    jobId: string,
    patch: Partial<{
      title: string;
      companyName: string;
      location: string | null;
      countryCode: string | null;
      url: string | null;
      description: string | null;
      salaryRaw: string | null;
      sponsorship: string;
    }>,
  ) {
    const [job] = await this.db
      .update(jobs)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, this.userId)))
      .returning();
    if (!job) return null;
    await this.db.insert(jobActivities).values({
      userId: this.userId,
      jobId,
      type: "edited",
      payload: { fields: Object.keys(patch) },
    });
    await syncSearchDoc("jobs", this.jobSearchDoc(job));
    return job;
  }

  async moveJobStage(jobId: string, stage: JobStage) {
    const current = await this.getJob(jobId);
    if (!current) return null;
    if (current.stage === stage) return current;
    const [job] = await this.db
      .update(jobs)
      .set({
        stage,
        updatedAt: new Date(),
        appliedAt: stage === "applied" && !current.appliedAt ? new Date() : current.appliedAt,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, this.userId)))
      .returning();
    await this.db.insert(jobActivities).values({
      userId: this.userId,
      jobId,
      type: "stage_changed",
      payload: { from: current.stage, to: stage },
    });
    await syncSearchDoc("jobs", this.jobSearchDoc(job));
    return job;
  }

  async addJobNote(jobId: string, note: string) {
    const job = await this.getJob(jobId);
    if (!job) return null;
    const [activity] = await this.db
      .insert(jobActivities)
      .values({ userId: this.userId, jobId, type: "note", payload: { note } })
      .returning();
    return activity;
  }

  async listJobActivities(jobId: string) {
    return this.db
      .select()
      .from(jobActivities)
      .where(and(eq(jobActivities.jobId, jobId), eq(jobActivities.userId, this.userId)))
      .orderBy(desc(jobActivities.createdAt));
  }

  async getJobSnapshot(jobId: string) {
    const rows = await this.db
      .select()
      .from(jobSnapshots)
      .where(and(eq(jobSnapshots.jobId, jobId), eq(jobSnapshots.userId, this.userId)))
      .orderBy(desc(jobSnapshots.capturedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteJob(jobId: string) {
    const [gone] = await this.db
      .delete(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, this.userId)))
      .returning({ id: jobs.id });
    if (gone) await removeSearchDoc("jobs", gone.id);
    return Boolean(gone);
  }

  /* ---------- companies ---------- */

  async listCompanies() {
    const watch = this.db
      .select({ companyId: companyWatchlist.companyId })
      .from(companyWatchlist)
      .where(eq(companyWatchlist.userId, this.userId));
    const rows = await this.db
      .select()
      .from(companies)
      .where(eq(companies.userId, this.userId))
      .orderBy(asc(companies.name));
    const watched = new Set((await watch).map((w) => w.companyId));
    return rows.map((c) => ({ ...c, watched: watched.has(c.id) }));
  }

  async createCompany(input: { name: string; website?: string; countryCode?: string }) {
    const [company] = await this.db
      .insert(companies)
      .values({ userId: this.userId, ...input })
      .returning();
    await syncSearchDoc("companies", {
      id: company.id,
      userId: this.userId,
      title: company.name,
      subtitle: company.website ?? "",
      href: "/companies",
      updatedAt: Date.now(),
    });
    return company;
  }

  async setCompanyWatch(companyId: string, watched: boolean) {
    const owned = await this.db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.userId, this.userId)))
      .limit(1);
    if (!owned[0]) return false;
    if (watched) {
      await this.db
        .insert(companyWatchlist)
        .values({ userId: this.userId, companyId })
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(companyWatchlist)
        .where(
          and(eq(companyWatchlist.userId, this.userId), eq(companyWatchlist.companyId, companyId)),
        );
    }
    return true;
  }

  async deleteCompany(companyId: string) {
    const [gone] = await this.db
      .delete(companies)
      .where(and(eq(companies.id, companyId), eq(companies.userId, this.userId)))
      .returning({ id: companies.id });
    if (gone) await removeSearchDoc("companies", gone.id);
    return Boolean(gone);
  }

  /**
   * "Not interested" in a recommended company: dismiss its discovered
   * (unsaved) roles so it stops appearing in Discover and in company
   * recommendations. Saved roles are left alone.
   */
  async dismissCompanyDiscovered(companyName: string) {
    const rows = await this.db
      .update(jobs)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(jobs.userId, this.userId),
          eq(jobs.saved, false),
          isNull(jobs.dismissedAt),
          sql`lower(${jobs.companyName}) = ${companyName.trim().toLowerCase()}`,
        ),
      )
      .returning({ id: jobs.id });
    return rows.length;
  }

  /* ---------- contacts ---------- */

  async listContacts() {
    return this.db
      .select()
      .from(contacts)
      .where(eq(contacts.userId, this.userId))
      .orderBy(asc(contacts.name));
  }

  async getContact(contactId: string) {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.userId, this.userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createContact(input: {
    name: string;
    role?: string;
    companyName?: string;
    email?: string;
    linkedin?: string;
    notes?: string;
  }) {
    const [contact] = await this.db
      .insert(contacts)
      .values({ userId: this.userId, ...input })
      .returning();
    await syncSearchDoc("contacts", {
      id: contact.id,
      userId: this.userId,
      title: contact.name,
      subtitle: [contact.role, contact.companyName].filter(Boolean).join(" · "),
      href: "/outreach",
      updatedAt: Date.now(),
    });
    return contact;
  }

  async updateContact(
    contactId: string,
    patch: { name?: string; role?: string; companyName?: string; email?: string; linkedin?: string; notes?: string },
  ) {
    // only set the fields that were provided; empty string clears a field
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["name", "role", "companyName", "email", "linkedin", "notes"] as const) {
      if (patch[k] !== undefined) set[k] = patch[k] === "" ? null : patch[k];
    }
    const [row] = await this.db
      .update(contacts)
      .set(set)
      .where(and(eq(contacts.id, contactId), eq(contacts.userId, this.userId)))
      .returning();
    if (!row) return null;
    await syncSearchDoc("contacts", {
      id: row.id,
      userId: this.userId,
      title: row.name,
      subtitle: [row.role, row.companyName].filter(Boolean).join(" · "),
      href: "/outreach",
      updatedAt: Date.now(),
    });
    return row;
  }

  async deleteContact(contactId: string) {
    const [gone] = await this.db
      .delete(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.userId, this.userId)))
      .returning({ id: contacts.id });
    if (gone) await removeSearchDoc("contacts", gone.id);
    return Boolean(gone);
  }

  /* ---------- documents ---------- */

  async listDocuments() {
    const docs = await this.db
      .select()
      .from(documents)
      .where(eq(documents.userId, this.userId))
      .orderBy(desc(documents.updatedAt));
    if (docs.length === 0) return [];
    const versions = await this.db
      .select({
        id: documentVersions.id,
        documentId: documentVersions.documentId,
        version: documentVersions.version,
        fileName: documentVersions.fileName,
        mime: documentVersions.mime,
        size: documentVersions.size,
        note: documentVersions.note,
        jobId: documentVersions.jobId,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.userId, this.userId),
          inArray(
            documentVersions.documentId,
            docs.map((d) => d.id),
          ),
        ),
      )
      .orderBy(desc(documentVersions.version));
    return docs.map((d) => ({
      ...d,
      versions: versions.filter((v) => v.documentId === d.id),
    }));
  }

  async createDocument(input: {
    kind: string;
    title: string;
    fileName: string;
    mime: string;
    contentBase64: string;
    note?: string;
  }) {
    const [doc] = await this.db
      .insert(documents)
      .values({ userId: this.userId, kind: input.kind, title: input.title })
      .returning();
    await this.db.insert(documentVersions).values({
      userId: this.userId,
      documentId: doc.id,
      version: 1,
      fileName: input.fileName,
      mime: input.mime,
      size: Math.floor((input.contentBase64.length * 3) / 4),
      content: input.contentBase64,
      note: input.note,
    });
    await syncSearchDoc("documents", {
      id: doc.id,
      userId: this.userId,
      title: doc.title,
      subtitle: input.fileName,
      href: "/documents",
      updatedAt: Date.now(),
    });
    return doc;
  }

  async addDocumentVersion(
    documentId: string,
    input: { fileName: string; mime: string; contentBase64: string; note?: string },
  ) {
    const owned = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, this.userId)))
      .limit(1);
    if (!owned[0]) return null;
    const [{ maxVersion }] = await this.db
      .select({ maxVersion: sql<number>`coalesce(max(${documentVersions.version}), 0)` })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId));
    const [version] = await this.db
      .insert(documentVersions)
      .values({
        userId: this.userId,
        documentId,
        version: Number(maxVersion) + 1,
        fileName: input.fileName,
        mime: input.mime,
        size: Math.floor((input.contentBase64.length * 3) / 4),
        content: input.contentBase64,
        note: input.note,
      })
      .returning();
    await this.db
      .update(documents)
      .set({ updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    return version;
  }

  /** The went-where link: this version went to this job. */
  async linkVersionToJob(versionId: string, jobId: string | null) {
    if (jobId) {
      const job = await this.getJob(jobId);
      if (!job) return false;
    }
    const [updated] = await this.db
      .update(documentVersions)
      .set({ jobId })
      .where(and(eq(documentVersions.id, versionId), eq(documentVersions.userId, this.userId)))
      .returning({ id: documentVersions.id, documentId: documentVersions.documentId });
    if (updated && jobId) {
      await this.db.insert(jobActivities).values({
        userId: this.userId,
        jobId,
        type: "document_linked",
        payload: { versionId: updated.id },
      });
    }
    return Boolean(updated);
  }

  async getDocumentVersionFile(versionId: string) {
    const rows = await this.db
      .select()
      .from(documentVersions)
      .where(and(eq(documentVersions.id, versionId), eq(documentVersions.userId, this.userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteDocument(documentId: string) {
    const [gone] = await this.db
      .delete(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, this.userId)))
      .returning({ id: documents.id });
    if (gone) await removeSearchDoc("documents", gone.id);
    return Boolean(gone);
  }

  async listVersionsForJob(jobId: string) {
    return this.db
      .select({
        id: documentVersions.id,
        documentId: documentVersions.documentId,
        version: documentVersions.version,
        fileName: documentVersions.fileName,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(and(eq(documentVersions.userId, this.userId), eq(documentVersions.jobId, jobId)));
  }

  /* ---------- interviews, with auto calendar events ---------- */

  async listInterviews() {
    return this.db
      .select({
        interview: interviews,
        jobTitle: jobs.title,
        jobCompany: jobs.companyName,
      })
      .from(interviews)
      .innerJoin(jobs, eq(jobs.id, interviews.jobId))
      .where(eq(interviews.userId, this.userId))
      .orderBy(asc(interviews.scheduledAt));
  }

  async createInterview(input: {
    jobId: string;
    round: string;
    medium: string;
    locationOrLink?: string;
    scheduledAt: Date;
    durationMin: number;
    reminderLeadMinutes: number[];
  }) {
    const job = await this.getJob(input.jobId);
    if (!job) return null;
    const [interview] = await this.db
      .insert(interviews)
      .values({
        userId: this.userId,
        jobId: input.jobId,
        round: input.round,
        medium: input.medium,
        locationOrLink: input.locationOrLink,
        scheduledAt: input.scheduledAt,
        durationMin: input.durationMin,
      })
      .returning();
    const [event] = await this.db
      .insert(calendarEvents)
      .values({
        userId: this.userId,
        kind: "interview",
        sourceType: "interview",
        sourceId: interview.id,
        title: `Interview, ${job.companyName || job.title}`,
        startsAt: input.scheduledAt,
        endsAt: new Date(input.scheduledAt.getTime() + input.durationMin * 60000),
        location: input.locationOrLink,
        notes: `${input.round}, ${input.medium} · ${job.title}`,
      })
      .returning();
    for (const lead of input.reminderLeadMinutes) {
      await this.db
        .insert(reminders)
        .values({ userId: this.userId, eventId: event.id, leadMinutes: lead });
    }
    await this.db.insert(jobActivities).values({
      userId: this.userId,
      jobId: input.jobId,
      type: "interview_scheduled",
      payload: { round: input.round, scheduledAt: input.scheduledAt.toISOString() },
    });
    return interview;
  }

  async updateInterview(
    interviewId: string,
    patch: Partial<{
      round: string;
      medium: string;
      locationOrLink: string | null;
      scheduledAt: Date;
      durationMin: number;
      outcome: string | null;
      notes: string | null;
    }>,
  ) {
    const [interview] = await this.db
      .update(interviews)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, this.userId)))
      .returning();
    if (!interview) return null;
    // the calendar event follows its source record
    await this.db
      .update(calendarEvents)
      .set({
        startsAt: interview.scheduledAt,
        endsAt: new Date(interview.scheduledAt.getTime() + interview.durationMin * 60000),
        location: interview.locationOrLink,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(calendarEvents.userId, this.userId),
          eq(calendarEvents.sourceType, "interview"),
          eq(calendarEvents.sourceId, interviewId),
        ),
      );
    return interview;
  }

  async deleteInterview(interviewId: string) {
    const [gone] = await this.db
      .delete(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, this.userId)))
      .returning({ id: interviews.id });
    if (gone) {
      await this.db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.userId, this.userId),
            eq(calendarEvents.sourceType, "interview"),
            eq(calendarEvents.sourceId, interviewId),
          ),
        );
    }
    return Boolean(gone);
  }

  /* ---------- offers ---------- */

  async listOffers() {
    return this.db
      .select({ offer: offers, jobTitle: jobs.title, jobCompany: jobs.companyName })
      .from(offers)
      .innerJoin(jobs, eq(jobs.id, offers.jobId))
      .where(eq(offers.userId, this.userId))
      .orderBy(desc(offers.receivedAt));
  }

  async createOffer(input: {
    jobId: string;
    baseSalary?: string;
    currency: string;
    period: string;
    bonus?: string;
    equity?: string;
    benefits?: string;
    relocation?: string;
    deadline?: string;
    notes?: string;
  }) {
    const job = await this.getJob(input.jobId);
    if (!job) return null;
    const [offer] = await this.db
      .insert(offers)
      .values({ userId: this.userId, ...input })
      .returning();
    if (input.deadline) {
      await this.db.insert(calendarEvents).values({
        userId: this.userId,
        kind: "deadline",
        sourceType: "offer",
        sourceId: offer.id,
        title: `Offer deadline, ${job.companyName || job.title}`,
        startsAt: new Date(`${input.deadline}T09:00:00Z`),
        allDay: true,
      });
    }
    await this.db.insert(jobActivities).values({
      userId: this.userId,
      jobId: input.jobId,
      type: "offer_recorded",
      payload: { currency: input.currency, baseSalary: input.baseSalary ?? null },
    });
    return offer;
  }

  async deleteOffer(offerId: string) {
    const [gone] = await this.db
      .delete(offers)
      .where(and(eq(offers.id, offerId), eq(offers.userId, this.userId)))
      .returning({ id: offers.id });
    if (gone) {
      await this.db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.userId, this.userId),
            eq(calendarEvents.sourceType, "offer"),
            eq(calendarEvents.sourceId, offerId),
          ),
        );
    }
    return Boolean(gone);
  }

  /* ---------- calendar ---------- */

  async listCalendarEvents(rangeStart: Date, rangeEnd: Date) {
    return this.db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, this.userId),
          lt(calendarEvents.startsAt, rangeEnd),
          sql`coalesce(${calendarEvents.endsAt}, ${calendarEvents.startsAt}) > ${rangeStart.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(asc(calendarEvents.startsAt));
  }

  async listAllCalendarEvents() {
    return this.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.userId, this.userId))
      .orderBy(asc(calendarEvents.startsAt));
  }

  async createCustomEvent(input: {
    title: string;
    startsAt: Date;
    endsAt?: Date;
    allDay?: boolean;
    location?: string;
    notes?: string;
    reminderLeadMinutes?: number[];
  }) {
    const [event] = await this.db
      .insert(calendarEvents)
      .values({ userId: this.userId, kind: "custom", ...input })
      .returning();
    for (const lead of input.reminderLeadMinutes ?? []) {
      await this.db
        .insert(reminders)
        .values({ userId: this.userId, eventId: event.id, leadMinutes: lead });
    }
    return event;
  }

  async deleteCustomEvent(eventId: string) {
    const [gone] = await this.db
      .delete(calendarEvents)
      .where(
        and(
          eq(calendarEvents.id, eventId),
          eq(calendarEvents.userId, this.userId),
          eq(calendarEvents.kind, "custom"),
        ),
      )
      .returning({ id: calendarEvents.id });
    return Boolean(gone);
  }

  /* ---------- agent memory and context ---------- */

  async listStandingInstructions() {
    return this.db
      .select()
      .from(standingInstructions)
      .where(eq(standingInstructions.userId, this.userId))
      .orderBy(asc(standingInstructions.position), asc(standingInstructions.createdAt));
  }

  async addStandingInstruction(instruction: string) {
    const [row] = await this.db
      .insert(standingInstructions)
      .values({ userId: this.userId, instruction })
      .returning();
    return row;
  }

  async deleteStandingInstruction(id: string) {
    const [gone] = await this.db
      .delete(standingInstructions)
      .where(and(eq(standingInstructions.id, id), eq(standingInstructions.userId, this.userId)))
      .returning({ id: standingInstructions.id });
    return Boolean(gone);
  }

  async getLearnedProfile(): Promise<Record<string, string>> {
    const rows = await this.db
      .select()
      .from(learnedProfile)
      .where(eq(learnedProfile.userId, this.userId))
      .limit(1);
    return (rows[0]?.data as Record<string, string>) ?? {};
  }

  /** Merges facts in; setting a fact to an empty string removes it. */
  async updateLearnedProfile(facts: Record<string, string>) {
    const current = await this.getLearnedProfile();
    const merged: Record<string, string> = { ...current };
    for (const [k, v] of Object.entries(facts)) {
      if (v === "") delete merged[k];
      else merged[k] = v;
    }
    await this.db
      .insert(learnedProfile)
      .values({ userId: this.userId, data: merged })
      .onConflictDoUpdate({ target: learnedProfile.userId, set: { data: merged, updatedAt: new Date() } });
    return merged;
  }

  async funnelStats() {
    const rows = await this.db
      .select({ stage: jobs.stage, count: sql<number>`count(*)` })
      .from(jobs)
      .where(and(eq(jobs.userId, this.userId), eq(jobs.saved, true)))
      .groupBy(jobs.stage);
    const byStage: Record<string, number> = {};
    for (const r of rows) byStage[r.stage] = Number(r.count);
    return byStage;
  }

  async upcomingEvents(days = 7) {
    const now = new Date();
    return this.listCalendarEvents(now, new Date(now.getTime() + days * 24 * 3600 * 1000));
  }

  async createOutreachMessage(input: {
    contactId?: string | null;
    jobId?: string | null;
    subject?: string;
    body: string;
    status: "draft" | "approved_draft";
    toEmail?: string;
  }) {
    const [row] = await this.db
      .insert(outreachMessages)
      .values({
        userId: this.userId,
        contactId: input.contactId ?? null,
        jobId: input.jobId ?? null,
        channel: "email",
        direction: "out",
        subject: input.subject ?? null,
        body: input.toEmail ? `To: ${input.toEmail}\n\n${input.body}` : input.body,
        status: input.status,
      })
      .returning();
    return row;
  }

  /* ---------- outreach (Phase 6) ---------- */

  async listOutreachMessages(limit = 100) {
    return this.db
      .select()
      .from(outreachMessages)
      .where(eq(outreachMessages.userId, this.userId))
      .orderBy(desc(outreachMessages.createdAt))
      .limit(limit);
  }

  async listOutreachForJob(jobId: string) {
    return this.db
      .select()
      .from(outreachMessages)
      .where(and(eq(outreachMessages.userId, this.userId), eq(outreachMessages.jobId, jobId)))
      .orderBy(desc(outreachMessages.createdAt));
  }

  /** Creates a multi-step sequence for a job and contact. */
  async createSequence(input: {
    name: string;
    jobId?: string | null;
    contactId?: string | null;
    steps: { kind: string; waitDays: number }[];
  }) {
    const [seq] = await this.db
      .insert(outreachSequences)
      .values({
        userId: this.userId,
        name: input.name,
        jobId: input.jobId ?? null,
        contactId: input.contactId ?? null,
        status: "active",
      })
      .returning();
    let cumulative = 0;
    for (let i = 0; i < input.steps.length; i++) {
      cumulative += input.steps[i].waitDays;
      await this.db.insert(sequenceSteps).values({
        userId: this.userId,
        sequenceId: seq.id,
        position: i,
        kind: input.steps[i].kind,
        waitDays: input.steps[i].waitDays,
        status: i === 0 ? "pending" : "scheduled",
        dueAt: new Date(Date.now() + cumulative * 24 * 3600 * 1000),
      });
    }
    return seq;
  }

  async listSequences() {
    const seqs = await this.db
      .select()
      .from(outreachSequences)
      .where(eq(outreachSequences.userId, this.userId))
      .orderBy(desc(outreachSequences.createdAt));
    const steps = await this.db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.userId, this.userId))
      .orderBy(asc(sequenceSteps.position));
    return seqs.map((s) => ({ ...s, steps: steps.filter((st) => st.sequenceId === s.id) }));
  }

  async stopSequence(sequenceId: string, reason: string) {
    await this.db
      .update(outreachSequences)
      .set({ status: `stopped:${reason}` })
      .where(and(eq(outreachSequences.id, sequenceId), eq(outreachSequences.userId, this.userId)));
  }

  /**
   * A/B summary per variant. Both figures count distinct contacts, so a
   * contact who received a variant twice is one recipient, and a reply
   * from that contact counts once. A/B tests assume one variant per
   * contact. All scoped to this user.
   */
  async experimentSummary() {
    const sent = await this.db
      .select({ variant: outreachMessages.variant, n: sql<number>`count(distinct ${outreachMessages.contactId})` })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.userId, this.userId),
          eq(outreachMessages.direction, "out"),
          sql`${outreachMessages.variant} is not null`,
          sql`${outreachMessages.contactId} is not null`,
        ),
      )
      .groupBy(outreachMessages.variant);
    const replies = await this.db
      .select({ variant: outreachMessages.variant, n: sql<number>`count(distinct ${outreachMessages.contactId})` })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.userId, this.userId),
          eq(outreachMessages.direction, "out"),
          sql`${outreachMessages.variant} is not null`,
          sql`${outreachMessages.contactId} is not null`,
          sql`exists (select 1 from outreach_messages r where r.user_id = ${this.userId} and r.direction = 'in' and r.contact_id = ${outreachMessages.contactId})`,
        ),
      )
      .groupBy(outreachMessages.variant);
    const replyMap = new Map(replies.map((r) => [r.variant, Number(r.n)]));
    return sent.map((s) => ({
      variant: s.variant ?? "unlabeled",
      sent: Number(s.n),
      replied: replyMap.get(s.variant) ?? 0,
    }));
  }

  async listLinkClicks() {
    return this.db
      .select()
      .from(linkClicks)
      .where(eq(linkClicks.userId, this.userId))
      .orderBy(desc(linkClicks.createdAt));
  }

  /* ---------- conversations ---------- */

  async listConversations() {
    return this.db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, this.userId))
      .orderBy(desc(conversations.updatedAt))
      .limit(50);
  }

  async getConversation(id: string) {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, this.userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createConversation(model?: string | null) {
    const [row] = await this.db
      .insert(conversations)
      .values({ userId: this.userId, model: model ?? null })
      .returning();
    return row;
  }

  async setConversationModel(id: string, model: string | null) {
    const [row] = await this.db
      .update(conversations)
      .set({ model, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.userId, this.userId)))
      .returning();
    return row ?? null;
  }

  async setConversationTitle(id: string, title: string) {
    await this.db
      .update(conversations)
      .set({ title: title.slice(0, 120), updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.userId, this.userId)));
  }

  async deleteConversation(id: string) {
    const [gone] = await this.db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, this.userId)))
      .returning({ id: conversations.id });
    return Boolean(gone);
  }

  async listMessages(conversationId: string, limit = 60) {
    const convo = await this.getConversation(conversationId);
    if (!convo) return [];
    const rows = await this.db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.conversationId, conversationId), eq(messagesTable.userId, this.userId)))
      .orderBy(desc(messagesTable.createdAt))
      .limit(limit);
    return rows.reverse();
  }

  async appendMessage(conversationId: string, role: string, content: string, toolCalls?: unknown) {
    const [row] = await this.db
      .insert(messagesTable)
      .values({ userId: this.userId, conversationId, role, content, toolCalls: toolCalls ?? null })
      .returning();
    await this.db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, this.userId)));
    return row;
  }

  async setMessageEmbedding(messageId: string, embedding: number[]) {
    await this.db
      .update(messagesTable)
      .set({ embedding })
      .where(and(eq(messagesTable.id, messageId), eq(messagesTable.userId, this.userId)));
  }

  /** Semantic recall: nearest past messages outside this conversation. */
  async recallMessages(embedding: number[], excludeConversationId: string, limit = 6) {
    const vec = JSON.stringify(embedding);
    return this.db
      .select({
        content: messagesTable.content,
        role: messagesTable.role,
        createdAt: messagesTable.createdAt,
      })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.userId, this.userId),
          sql`${messagesTable.embedding} is not null`,
          sql`${messagesTable.conversationId} != ${excludeConversationId}`,
        ),
      )
      .orderBy(sql`${messagesTable.embedding} <=> ${vec}::vector`)
      .limit(limit);
  }

  async recentActivity(limit = 8) {
    return this.db
      .select({
        type: jobActivities.type,
        payload: jobActivities.payload,
        createdAt: jobActivities.createdAt,
        jobTitle: jobs.title,
        jobCompany: jobs.companyName,
      })
      .from(jobActivities)
      .innerJoin(jobs, eq(jobs.id, jobActivities.jobId))
      .where(eq(jobActivities.userId, this.userId))
      .orderBy(desc(jobActivities.createdAt))
      .limit(limit);
  }

  /* ---------- profile (Phase 5) ---------- */

  async getMasterProfile() {
    const rows = await this.db
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, this.userId), eq(profiles.kind, "master")))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Saves the parsed draft profile, unconfirmed, pending user review. */
  async saveDraftProfile(data: unknown) {
    const existing = await this.getMasterProfile();
    if (existing) {
      const [row] = await this.db
        .update(profiles)
        .set({ data, updatedAt: new Date() })
        .where(and(eq(profiles.id, existing.id), eq(profiles.userId, this.userId)))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(profiles)
      .values({ userId: this.userId, kind: "master", name: "Master profile", data })
      .returning();
    return row;
  }

  /** The mandatory confirm step: stores the reviewed profile and its embedding. */
  async confirmProfile(data: unknown, embedding: number[] | null) {
    const existing = await this.getMasterProfile();
    if (existing) {
      const [row] = await this.db
        .update(profiles)
        .set({ data, embedding: embedding ?? undefined, confirmedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(profiles.id, existing.id), eq(profiles.userId, this.userId)))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(profiles)
      .values({
        userId: this.userId,
        kind: "master",
        name: "Master profile",
        data,
        embedding: embedding ?? undefined,
        confirmedAt: new Date(),
      })
      .returning();
    return row;
  }

  async getConfirmedProfileData(): Promise<Record<string, unknown> | null> {
    const p = await this.getMasterProfile();
    if (!p || !p.confirmedAt) return null;
    return (p.data as Record<string, unknown>) ?? null;
  }

  async getProfileEmbedding(): Promise<number[] | null> {
    const p = await this.getMasterProfile();
    return (p?.embedding as number[] | null) ?? null;
  }

  /* ---------- applications (Phase 5) ---------- */

  async createApplication(input: {
    jobId: string;
    cvVersionId?: string | null;
    coverLetterVersionId?: string | null;
    formAnswers?: unknown;
  }) {
    const job = await this.getJob(input.jobId);
    if (!job) return null;
    const [app] = await this.db
      .insert(applications)
      .values({
        userId: this.userId,
        jobId: input.jobId,
        cvVersionId: input.cvVersionId ?? null,
        coverLetterVersionId: input.coverLetterVersionId ?? null,
        formAnswers: input.formAnswers ?? null,
        submittedAt: new Date(),
      })
      .returning();
    // marking applied moves the pipeline and logs the exact versions sent
    await this.moveJobStage(input.jobId, "applied");
    await this.db.insert(jobActivities).values({
      userId: this.userId,
      jobId: input.jobId,
      type: "applied",
      payload: {
        applicationId: app.id,
        cvVersionId: input.cvVersionId ?? null,
        coverLetterVersionId: input.coverLetterVersionId ?? null,
      },
    });
    return app;
  }

  async getApplicationForJob(jobId: string) {
    const rows = await this.db
      .select()
      .from(applications)
      .where(and(eq(applications.jobId, jobId), eq(applications.userId, this.userId)))
      .orderBy(desc(applications.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Stores a generated file as a document version linked to a job. */
  async saveGeneratedDoc(input: {
    kind: string;
    title: string;
    fileName: string;
    mime: string;
    base64: string;
    jobId: string;
    note?: string;
  }) {
    const doc = await this.createDocument({
      kind: input.kind,
      title: input.title,
      fileName: input.fileName,
      mime: input.mime,
      contentBase64: input.base64,
      note: input.note,
    });
    const [v] = await this.db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.userId, this.userId)))
      .limit(1);
    if (v) await this.linkVersionToJob(v.id, input.jobId);
    return { documentId: doc.id, versionId: v?.id ?? null };
  }

  /* ---------- intelligence: briefs and signals (Phase 7) ---------- */

  async getCompany(companyId: string) {
    const rows = await this.db
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.userId, this.userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Finds a company by name (case-insensitive) or creates it. Scoped. */
  async getOrCreateCompany(input: { name: string; website?: string; countryCode?: string }) {
    const existing = await this.db
      .select()
      .from(companies)
      .where(and(eq(companies.userId, this.userId), sql`lower(${companies.name}) = lower(${input.name})`))
      .limit(1);
    if (existing[0]) return existing[0];
    return this.createCompany(input);
  }

  /**
   * Stores a research brief under the company's brief.research key,
   * merging so the watchlist's brief.ats detection is never clobbered.
   */
  async saveCompanyBrief(companyId: string, brief: unknown) {
    const current = await this.getCompany(companyId);
    if (!current) return null;
    const existing = (current.brief as Record<string, unknown> | null) ?? {};
    const [row] = await this.db
      .update(companies)
      .set({ brief: { ...existing, research: brief }, updatedAt: new Date() })
      .where(and(eq(companies.id, companyId), eq(companies.userId, this.userId)))
      .returning();
    return row ?? null;
  }

  async listSignals(limit = 60) {
    return this.db
      .select({
        id: signals.id,
        companyId: signals.companyId,
        companyName: companies.name,
        type: signals.type,
        payload: signals.payload,
        detectedAt: signals.detectedAt,
      })
      .from(signals)
      .innerJoin(companies, eq(companies.id, signals.companyId))
      .where(eq(signals.userId, this.userId))
      .orderBy(desc(signals.detectedAt))
      .limit(limit);
  }

  async createSignal(companyId: string, type: string, payload: Record<string, unknown>) {
    const owned = await this.getCompany(companyId);
    if (!owned) return null;
    const [row] = await this.db
      .insert(signals)
      .values({ userId: this.userId, companyId, type, payload })
      .returning();
    return row;
  }

  /* ---------- mailbox ---------- */

  async getMailAccount() {
    const [row] = await this.db
      .select()
      .from(mailAccounts)
      .where(eq(mailAccounts.userId, this.userId))
      .limit(1);
    return row ?? null;
  }

  async upsertMailAccount(input: {
    email: string;
    displayName: string | null;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    username: string;
  }) {
    const [row] = await this.db
      .insert(mailAccounts)
      .values({ userId: this.userId, ...input, status: "active" })
      .onConflictDoUpdate({
        target: mailAccounts.userId,
        set: { ...input, status: "active", lastError: null, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async deleteMailAccount() {
    await this.db.delete(mailAccounts).where(eq(mailAccounts.userId, this.userId));
  }

  async listMailFolders() {
    return this.db
      .select()
      .from(mailFolders)
      .where(eq(mailFolders.userId, this.userId))
      .orderBy(asc(mailFolders.sortOrder), asc(mailFolders.name));
  }

  /** Enqueues an outbound send. Idempotent on idempotencyKey (retried POST is safe). */
  async enqueueMailSend(input: {
    accountId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    sendAfter: Date;
    status?: string;
    draftMessageId?: string | null;
  }) {
    const [row] = await this.db
      .insert(mailOutbox)
      .values({
        userId: this.userId,
        accountId: input.accountId,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        sendAfter: input.sendAfter,
        status: input.status ?? "queued",
        draftMessageId: input.draftMessageId ?? null,
      })
      .onConflictDoNothing({ target: mailOutbox.idempotencyKey })
      .returning();
    if (row) return row;
    const [existing] = await this.db
      .select()
      .from(mailOutbox)
      .where(and(eq(mailOutbox.userId, this.userId), eq(mailOutbox.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    return existing ?? null;
  }

  /** Undo/cancel: cancels a queued or scheduled row not yet dispatched. */
  async cancelMailSend(id: string) {
    const [row] = await this.db
      .update(mailOutbox)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(mailOutbox.id, id),
          eq(mailOutbox.userId, this.userId),
          inArray(mailOutbox.status, ["queued", "scheduled"]),
          gt(mailOutbox.sendAfter, new Date()),
        ),
      )
      .returning({ id: mailOutbox.id });
    return Boolean(row);
  }

  /** Future-dated sends (schedule-send) awaiting dispatch. */
  async listScheduledSends() {
    return this.db
      .select({
        id: mailOutbox.id,
        payload: mailOutbox.payload,
        sendAfter: mailOutbox.sendAfter,
        status: mailOutbox.status,
      })
      .from(mailOutbox)
      .where(
        and(
          eq(mailOutbox.userId, this.userId),
          eq(mailOutbox.status, "scheduled"),
          gt(mailOutbox.sendAfter, new Date()),
        ),
      )
      .orderBy(asc(mailOutbox.sendAfter));
  }

  /* ---------- signature ---------- */

  async updateMailSignature(html: string) {
    await this.db
      .update(mailAccounts)
      .set({ signatureHtml: html, updatedAt: new Date() })
      .where(eq(mailAccounts.userId, this.userId));
  }

  /* ---------- drafts (autosave) ---------- */

  async upsertMailDraft(input: {
    id?: string | null;
    toText: string;
    ccText: string;
    bccText: string;
    subject: string;
    html: string;
    bodyText: string;
    plainMode: boolean;
    attachmentIds: string[];
    inReplyTo?: string | null;
    referencesHdr?: string | null;
  }) {
    const values = {
      toText: input.toText,
      ccText: input.ccText,
      bccText: input.bccText,
      subject: input.subject,
      html: input.html,
      bodyText: input.bodyText,
      plainMode: input.plainMode,
      attachmentIds: input.attachmentIds,
      inReplyTo: input.inReplyTo ?? null,
      referencesHdr: input.referencesHdr ?? null,
      updatedAt: new Date(),
    };
    if (input.id) {
      const [row] = await this.db
        .update(mailDrafts)
        .set(values)
        .where(and(eq(mailDrafts.id, input.id), eq(mailDrafts.userId, this.userId)))
        .returning({ id: mailDrafts.id });
      if (row) return row;
    }
    const [row] = await this.db
      .insert(mailDrafts)
      .values({ userId: this.userId, ...values })
      .returning({ id: mailDrafts.id });
    return row;
  }

  async listMailDrafts() {
    return this.db
      .select({
        id: mailDrafts.id,
        subject: mailDrafts.subject,
        toText: mailDrafts.toText,
        bodyText: mailDrafts.bodyText,
        updatedAt: mailDrafts.updatedAt,
      })
      .from(mailDrafts)
      .where(eq(mailDrafts.userId, this.userId))
      .orderBy(desc(mailDrafts.updatedAt));
  }

  async getMailDraft(id: string) {
    const [row] = await this.db
      .select()
      .from(mailDrafts)
      .where(and(eq(mailDrafts.id, id), eq(mailDrafts.userId, this.userId)))
      .limit(1);
    return row ?? null;
  }

  async deleteMailDraft(id: string) {
    await this.db.delete(mailDrafts).where(and(eq(mailDrafts.id, id), eq(mailDrafts.userId, this.userId)));
  }

  /** Per-folder total + unread counts (visible mail only; snoozed excluded). */
  async mailFolderCounts() {
    return this.db
      .select({
        folderId: mailMessages.folderId,
        total: sql<number>`count(*)`,
        unread: sql<number>`count(*) filter (where not ${mailMessages.isRead})`,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.userId, this.userId),
          isNull(mailMessages.deletedAt),
          sql`(${mailMessages.snoozedUntil} is null or ${mailMessages.snoozedUntil} <= now())`,
        ),
      )
      .groupBy(mailMessages.folderId);
  }

  /** Newest-first messages in a folder, cursor-paginated, optional full-text query. */
  async listFolderMessages(input: {
    folderId: string;
    q?: string | null;
    cursor?: { receivedAt: string; id: string } | null;
    limit?: number;
  }) {
    const limit = input.limit ?? 40;
    const conds = [
      eq(mailMessages.userId, this.userId),
      eq(mailMessages.folderId, input.folderId),
      isNull(mailMessages.deletedAt),
      sql`(${mailMessages.snoozedUntil} is null or ${mailMessages.snoozedUntil} <= now())`,
    ];
    if (input.q && input.q.trim()) {
      const p = parseMailSearch(input.q.trim());
      if (p.text) conds.push(sql`search_vec @@ websearch_to_tsquery('simple', ${p.text})`);
      if (p.from) conds.push(sql`${mailMessages.fromAddr}->>'address' ilike ${`%${p.from}%`}`);
      if (p.to) conds.push(sql`${mailMessages.toAddrs}::text ilike ${`%${p.to}%`}`);
      if (p.subject) conds.push(sql`${mailMessages.subject} ilike ${`%${p.subject}%`}`);
      if (p.isUnread) conds.push(eq(mailMessages.isRead, false));
      if (p.isStarred) conds.push(eq(mailMessages.isStarred, true));
      if (p.hasAttachment) conds.push(eq(mailMessages.hasAttachments, true));
      if (p.before) conds.push(sql`${mailMessages.receivedAt} < ${p.before}`);
      if (p.after) conds.push(sql`${mailMessages.receivedAt} >= ${p.after}`);
    }
    if (input.cursor) {
      conds.push(
        sql`(${mailMessages.receivedAt}, ${mailMessages.id}) < (${new Date(input.cursor.receivedAt)}, ${input.cursor.id})`,
      );
    }
    const rows = await this.db
      .select({
        id: mailMessages.id,
        subject: mailMessages.subject,
        fromAddr: mailMessages.fromAddr,
        toAddrs: mailMessages.toAddrs,
        snippet: mailMessages.snippet,
        isRead: mailMessages.isRead,
        isStarred: mailMessages.isStarred,
        hasAttachments: mailMessages.hasAttachments,
        receivedAt: mailMessages.receivedAt,
        threadId: mailMessages.threadId,
      })
      .from(mailMessages)
      .where(and(...conds))
      .orderBy(desc(mailMessages.receivedAt), desc(mailMessages.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    return { messages: rows.slice(0, limit), hasMore: more };
  }

  async getMailMessage(messageId: string) {
    const [row] = await this.db
      .select()
      .from(mailMessages)
      .where(and(eq(mailMessages.id, messageId), eq(mailMessages.userId, this.userId)))
      .limit(1);
    return row ?? null;
  }

  async listMailAttachments(messageId: string) {
    return this.db
      .select({
        id: mailAttachments.id,
        filename: mailAttachments.filename,
        contentType: mailAttachments.contentType,
        sizeBytes: mailAttachments.sizeBytes,
        isInline: mailAttachments.isInline,
        contentId: mailAttachments.contentId,
      })
      .from(mailAttachments)
      .where(and(eq(mailAttachments.messageId, messageId), eq(mailAttachments.userId, this.userId)));
  }

  async getMailAttachment(attachmentId: string) {
    const [row] = await this.db
      .select()
      .from(mailAttachments)
      .where(and(eq(mailAttachments.id, attachmentId), eq(mailAttachments.userId, this.userId)))
      .limit(1);
    return row ?? null;
  }

  /** Flag a message read/unread (optimistic; the worker mirrors to IMAP). */
  async setMailRead(messageId: string, read: boolean) {
    const [row] = await this.db
      .update(mailMessages)
      .set({ isRead: read })
      .where(and(eq(mailMessages.id, messageId), eq(mailMessages.userId, this.userId)))
      .returning({ id: mailMessages.id });
    return Boolean(row);
  }

  async setMailStar(messageId: string, starred: boolean) {
    const [row] = await this.db
      .update(mailMessages)
      .set({ isStarred: starred })
      .where(and(eq(mailMessages.id, messageId), eq(mailMessages.userId, this.userId)))
      .returning({ id: mailMessages.id });
    return Boolean(row);
  }

  /** Move/trash/archive: optimistically hide from folder views; sync reconciles. */
  async hideMailMessage(messageId: string) {
    const [row] = await this.db
      .update(mailMessages)
      .set({ deletedAt: new Date() })
      .where(and(eq(mailMessages.id, messageId), eq(mailMessages.userId, this.userId)))
      .returning({ id: mailMessages.id });
    return Boolean(row);
  }

  /* ---------- snooze ---------- */

  /** Hides a message until `until` (or un-snoozes immediately when null). */
  async snoozeMessage(messageId: string, until: Date | null) {
    // snoozing marks read so it disappears cleanly; it resurfaces unread later
    const set = until ? { snoozedUntil: until, isRead: true } : { snoozedUntil: null };
    const [row] = await this.db
      .update(mailMessages)
      .set(set)
      .where(and(eq(mailMessages.id, messageId), eq(mailMessages.userId, this.userId)))
      .returning({ id: mailMessages.id });
    return Boolean(row);
  }

  /** Currently-snoozed messages across all folders (the "Snoozed" view). */
  async listSnoozed() {
    return this.db
      .select({
        id: mailMessages.id,
        subject: mailMessages.subject,
        fromAddr: mailMessages.fromAddr,
        toAddrs: mailMessages.toAddrs,
        snippet: mailMessages.snippet,
        isRead: mailMessages.isRead,
        isStarred: mailMessages.isStarred,
        hasAttachments: mailMessages.hasAttachments,
        receivedAt: mailMessages.receivedAt,
        snoozedUntil: mailMessages.snoozedUntil,
        threadId: mailMessages.threadId,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.userId, this.userId),
          isNull(mailMessages.deletedAt),
          isNotNull(mailMessages.snoozedUntil),
          gt(mailMessages.snoozedUntil, new Date()),
        ),
      )
      .orderBy(asc(mailMessages.snoozedUntil))
      .limit(100);
  }

  /* ---------- contact autocomplete ---------- */

  /** Address-book matches for compose autocomplete, best (most-used) first. */
  async searchContacts(q: string, limit = 8) {
    const needle = q.trim().toLowerCase();
    const conds = [eq(mailContacts.userId, this.userId)];
    if (needle) {
      conds.push(
        sql`(lower(${mailContacts.email}) like ${`%${needle}%`} or lower(coalesce(${mailContacts.name}, '')) like ${`%${needle}%`})`,
      );
    }
    return this.db
      .select({ email: mailContacts.email, name: mailContacts.name })
      .from(mailContacts)
      .where(and(...conds))
      .orderBy(desc(mailContacts.useCount), desc(mailContacts.lastUsedAt))
      .limit(limit);
  }

  /* ---------- filters / rules ---------- */

  async listMailRules() {
    return this.db
      .select()
      .from(mailRules)
      .where(eq(mailRules.userId, this.userId))
      .orderBy(asc(mailRules.position), asc(mailRules.createdAt));
  }

  async createMailRule(input: {
    accountId: string;
    name: string;
    enabled: boolean;
    conditions: unknown;
    actions: unknown;
    stopProcessing: boolean;
  }) {
    // append to the end of the ordering
    const [max] = await this.db
      .select({ m: sql<number>`coalesce(max(${mailRules.position}), 0)` })
      .from(mailRules)
      .where(eq(mailRules.userId, this.userId));
    const [row] = await this.db
      .insert(mailRules)
      .values({
        userId: this.userId,
        accountId: input.accountId,
        name: input.name,
        enabled: input.enabled,
        position: Number(max?.m ?? 0) + 10,
        conditions: input.conditions,
        actions: input.actions,
        stopProcessing: input.stopProcessing,
      })
      .returning();
    return row;
  }

  async updateMailRule(
    id: string,
    patch: Partial<{
      name: string;
      enabled: boolean;
      conditions: unknown;
      actions: unknown;
      stopProcessing: boolean;
      position: number;
    }>,
  ) {
    const [row] = await this.db
      .update(mailRules)
      .set(patch)
      .where(and(eq(mailRules.id, id), eq(mailRules.userId, this.userId)))
      .returning({ id: mailRules.id });
    return Boolean(row);
  }

  async deleteMailRule(id: string) {
    await this.db.delete(mailRules).where(and(eq(mailRules.id, id), eq(mailRules.userId, this.userId)));
  }

  /* ---------- compose attachments ---------- */

  async createMailUpload(input: {
    filename: string;
    contentType: string;
    sizeBytes: number;
    content: string;
  }) {
    const [row] = await this.db
      .insert(mailUploads)
      .values({ userId: this.userId, ...input })
      .returning({ id: mailUploads.id, filename: mailUploads.filename, sizeBytes: mailUploads.sizeBytes });
    return row;
  }

  async deleteMailUpload(id: string) {
    await this.db
      .delete(mailUploads)
      .where(and(eq(mailUploads.id, id), eq(mailUploads.userId, this.userId)));
  }

  /** Owned-upload metadata for the given ids (validates ownership + totals size). */
  async mailUploadsMeta(ids: string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select({ id: mailUploads.id, sizeBytes: mailUploads.sizeBytes })
      .from(mailUploads)
      .where(and(eq(mailUploads.userId, this.userId), inArray(mailUploads.id, ids)));
  }

  /* ---------- interview prep packs (Phase 7) ---------- */

  async getInterview(interviewId: string) {
    const rows = await this.db
      .select({
        interview: interviews,
        jobTitle: jobs.title,
        jobCompany: jobs.companyName,
        jobDescription: jobs.description,
        jobId: jobs.id,
      })
      .from(interviews)
      .innerJoin(jobs, eq(jobs.id, interviews.jobId))
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, this.userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async savePrepPack(input: { interviewId: string; jobId: string; content: unknown }) {
    const [row] = await this.db
      .insert(prepPacks)
      .values({
        userId: this.userId,
        interviewId: input.interviewId,
        jobId: input.jobId,
        content: input.content,
      })
      .returning();
    return row;
  }

  async getPrepPackForInterview(interviewId: string) {
    const rows = await this.db
      .select()
      .from(prepPacks)
      .where(and(eq(prepPacks.interviewId, interviewId), eq(prepPacks.userId, this.userId)))
      .orderBy(desc(prepPacks.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async listPrepPacks() {
    return this.db
      .select()
      .from(prepPacks)
      .where(eq(prepPacks.userId, this.userId))
      .orderBy(desc(prepPacks.createdAt));
  }

  /* ---------- STAR story bank (Phase 7) ---------- */

  async listStories() {
    return this.db
      .select()
      .from(storyBank)
      .where(eq(storyBank.userId, this.userId))
      .orderBy(asc(storyBank.competency), desc(storyBank.createdAt));
  }

  async createStory(input: {
    title: string;
    competency: string;
    situation?: string;
    task?: string;
    action?: string;
    result?: string;
    embedding?: number[] | null;
  }) {
    const [row] = await this.db
      .insert(storyBank)
      .values({
        userId: this.userId,
        title: input.title,
        competency: input.competency,
        situation: input.situation ?? null,
        task: input.task ?? null,
        action: input.action ?? null,
        result: input.result ?? null,
        embedding: input.embedding ?? undefined,
      })
      .returning();
    return row;
  }

  async updateStory(
    id: string,
    patch: Partial<{
      title: string;
      competency: string;
      situation: string | null;
      task: string | null;
      action: string | null;
      result: string | null;
      embedding: number[];
    }>,
  ) {
    const [row] = await this.db
      .update(storyBank)
      .set(patch)
      .where(and(eq(storyBank.id, id), eq(storyBank.userId, this.userId)))
      .returning();
    return row ?? null;
  }

  async deleteStory(id: string) {
    const [gone] = await this.db
      .delete(storyBank)
      .where(and(eq(storyBank.id, id), eq(storyBank.userId, this.userId)))
      .returning({ id: storyBank.id });
    return Boolean(gone);
  }

  /** Nearest stories by embedding, for mapping questions to lived examples. */
  async recallStories(embedding: number[], limit = 4) {
    const vec = JSON.stringify(embedding);
    return this.db
      .select({
        id: storyBank.id,
        title: storyBank.title,
        competency: storyBank.competency,
        situation: storyBank.situation,
        task: storyBank.task,
        action: storyBank.action,
        result: storyBank.result,
      })
      .from(storyBank)
      .where(and(eq(storyBank.userId, this.userId), sql`${storyBank.embedding} is not null`))
      .orderBy(sql`${storyBank.embedding} <=> ${vec}::vector`)
      .limit(limit);
  }

  /* ---------- analytics (Phase 7) ---------- */

  /**
   * Channel effectiveness: for each source that brought jobs into the
   * pipeline, how many reached applied, interview, and offer. Counts
   * saved jobs only, since discovered candidates have no outcome yet.
   */
  async channelEffectiveness() {
    const rows = await this.db
      .select({
        source: jobs.source,
        total: sql<number>`count(*)`,
        applied: sql<number>`count(*) filter (where ${jobs.appliedAt} is not null)`,
        interview: sql<number>`count(*) filter (where ${jobs.stage} in ('interview','offer'))`,
        offer: sql<number>`count(*) filter (where ${jobs.stage} = 'offer')`,
        rejected: sql<number>`count(*) filter (where ${jobs.stage} = 'rejected')`,
      })
      .from(jobs)
      .where(and(eq(jobs.userId, this.userId), eq(jobs.saved, true)))
      .groupBy(jobs.source)
      .orderBy(desc(sql`count(*)`));
    return rows.map((r) => ({
      source: r.source,
      total: Number(r.total),
      applied: Number(r.applied),
      interview: Number(r.interview),
      offer: Number(r.offer),
      rejected: Number(r.rejected),
    }));
  }

  /**
   * Response-time patterns from outreach: for each outbound message that
   * later drew an inbound reply from the same contact, the days between.
   * Returns the raw gaps and a median, honest about how few there are.
   */
  async responseTimePatterns() {
    // measure from when the outbound message was actually sent, and only
    // pair messages that were genuinely sent (not copy-ready drafts), so
    // unsent drafts never skew the gaps
    const raw = await this.db.execute(sql`
      select o.id,
             extract(epoch from (min(i.created_at) - o.sent_at)) / 86400.0 as days
      from outreach_messages o
      join outreach_messages i
        on i.user_id = o.user_id
       and i.contact_id = o.contact_id
       and i.direction = 'in'
       and i.created_at > o.sent_at
      where o.user_id = ${this.userId}
        and o.direction = 'out'
        and o.sent_at is not null
        and o.contact_id is not null
      group by o.id, o.sent_at
    `);
    // postgres-js returns an array; guard for a {rows} shape defensively
    const rows = (Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])) as {
      days: number | string;
    }[];
    const gaps = rows
      .map((r) => Number(r.days))
      .filter((d) => Number.isFinite(d) && d >= 0)
      .sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : null;
    return { gaps, median, n: gaps.length };
  }

  /**
   * Outcome samples for closed-loop learning: one row per saved job that
   * has reached a terminal-ish state, with the document and outreach
   * features that accompanied it. Deliberately raw; correlation and
   * sample-size honesty happen in the insight layer.
   */
  async outcomeSamples() {
    const savedJobs = await this.db
      .select({
        id: jobs.id,
        stage: jobs.stage,
        appliedAt: jobs.appliedAt,
        source: jobs.source,
      })
      .from(jobs)
      .where(and(eq(jobs.userId, this.userId), eq(jobs.saved, true)));
    if (savedJobs.length === 0) return [];
    const ids = savedJobs.map((j) => j.id);
    const apps = await this.db
      .select()
      .from(applications)
      .where(and(eq(applications.userId, this.userId), inArray(applications.jobId, ids)));
    const outreach = await this.db
      .select({
        jobId: outreachMessages.jobId,
        direction: outreachMessages.direction,
        body: outreachMessages.body,
      })
      .from(outreachMessages)
      .where(and(eq(outreachMessages.userId, this.userId), inArray(outreachMessages.jobId, ids)));
    return savedJobs.map((j) => {
      const app = apps.find((a) => a.jobId === j.id);
      const jobOutreach = outreach.filter((o) => o.jobId === j.id && o.direction === "out");
      return {
        jobId: j.id,
        stage: j.stage,
        source: j.source,
        applied: Boolean(j.appliedAt),
        hasTailoredCv: Boolean(app?.cvVersionId),
        hasCoverLetter: Boolean(app?.coverLetterVersionId),
        outreachCount: jobOutreach.length,
        outreachWords: jobOutreach.length
          ? Math.round(jobOutreach.reduce((s, o) => s + o.body.split(/\s+/).length, 0) / jobOutreach.length)
          : 0,
        reachedInterview: ["interview", "offer"].includes(j.stage),
        reachedOffer: j.stage === "offer",
        rejected: j.stage === "rejected",
      };
    });
  }

  /**
   * Salary observations across the user's jobs (saved and discovered),
   * for a role and market aggregation. Only rows with a parsed currency
   * and amount are returned; the intel layer normalizes to annual EUR.
   */
  async salaryObservations() {
    return this.db
      .select({
        title: jobs.title,
        countryCode: jobs.countryCode,
        market: jobs.market,
        salaryMin: jobs.salaryMin,
        salaryMax: jobs.salaryMax,
        salaryCurrency: jobs.salaryCurrency,
        salaryPeriod: jobs.salaryPeriod,
      })
      .from(jobs)
      .where(and(eq(jobs.userId, this.userId), sql`${jobs.salaryCurrency} is not null`));
  }

  /**
   * Company-level aggregates across the user's jobs, for proactive
   * recommendations. Groups discovered and saved jobs by company, with
   * the best match score, how many roles, sponsorship, and a sample
   * title. Marks companies the user already tracks so they can be
   * filtered out of suggestions.
   */
  async companyAggregates() {
    const rows = await this.db
      .select({
        companyName: jobs.companyName,
        countryCode: sql<string | null>`max(${jobs.countryCode})`,
        roleCount: sql<number>`count(*)`,
        bestMatch: sql<number>`max(coalesce(${jobs.matchScore}, 0))`,
        // best sponsorship wins: confirmed over inferred over unknown,
        // not the lexical max (which would pick "unknown")
        sponsorship: sql<string>`case max(case when ${jobs.sponsorship} = 'confirmed' then 2 when ${jobs.sponsorship} = 'inferred' then 1 else 0 end) when 2 then 'confirmed' when 1 then 'inferred' else 'unknown' end`,
        sampleTitle: sql<string>`max(${jobs.title})`,
        savedCount: sql<number>`count(*) filter (where ${jobs.saved} = true)`,
      })
      .from(jobs)
      // dismissed jobs must not keep recommending their company
      .where(and(eq(jobs.userId, this.userId), isNull(jobs.dismissedAt), sql`${jobs.companyName} <> ''`))
      .groupBy(jobs.companyName);
    const tracked = await this.db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.userId, this.userId));
    const trackedSet = new Set(tracked.map((t) => t.name.toLowerCase()));
    return rows.map((r) => ({
      companyName: r.companyName,
      countryCode: r.countryCode,
      roleCount: Number(r.roleCount),
      bestMatch: Number(r.bestMatch),
      sponsorship: r.sponsorship,
      sampleTitle: r.sampleTitle,
      savedCount: Number(r.savedCount),
      tracked: trackedSet.has(r.companyName.toLowerCase()),
    }));
  }

  /* ---------- export and deletion ---------- */

  /**
   * Complete archive of the user's data. Vault entries appear as
   * metadata only: secret values are write-only and never exported.
   */
  async exportAll() {
    const [user] = await this.db.select().from(users).where(eq(users.id, this.userId)).limit(1);
    const collect = async <T>(q: Promise<T>) => q;
    const archive = {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        onboardedAt: user.onboardedAt,
      },
      settings: await this.getSettings(),
      jobs: await this.listJobs(),
      jobSnapshots: await collect(
        this.db.select().from(jobSnapshots).where(eq(jobSnapshots.userId, this.userId)),
      ),
      jobActivities: await collect(
        this.db.select().from(jobActivities).where(eq(jobActivities.userId, this.userId)),
      ),
      companies: await collect(
        this.db.select().from(companies).where(eq(companies.userId, this.userId)),
      ),
      contacts: await this.listContacts(),
      documents: await collect(
        this.db.select().from(documents).where(eq(documents.userId, this.userId)),
      ),
      documentVersions: await collect(
        this.db
          .select({
            id: documentVersions.id,
            documentId: documentVersions.documentId,
            version: documentVersions.version,
            fileName: documentVersions.fileName,
            mime: documentVersions.mime,
            size: documentVersions.size,
            note: documentVersions.note,
            jobId: documentVersions.jobId,
            createdAt: documentVersions.createdAt,
            content: documentVersions.content,
          })
          .from(documentVersions)
          .where(eq(documentVersions.userId, this.userId)),
      ),
      applications: await collect(
        this.db.select().from(applications).where(eq(applications.userId, this.userId)),
      ),
      interviews: await collect(
        this.db.select().from(interviews).where(eq(interviews.userId, this.userId)),
      ),
      offers: await collect(this.db.select().from(offers).where(eq(offers.userId, this.userId))),
      calendarEvents: await this.listAllCalendarEvents(),
      reminders: await collect(
        this.db.select().from(reminders).where(eq(reminders.userId, this.userId)),
      ),
      conversations: await collect(
        this.db.select().from(conversations).where(eq(conversations.userId, this.userId)),
      ),
      messages: await collect(
        this.db
          .select({
            id: messagesTable.id,
            conversationId: messagesTable.conversationId,
            role: messagesTable.role,
            content: messagesTable.content,
            createdAt: messagesTable.createdAt,
          })
          .from(messagesTable)
          .where(eq(messagesTable.userId, this.userId)),
      ),
      standingInstructions: await this.listStandingInstructions(),
      learnedProfile: await this.getLearnedProfile(),
      approvals: await collect(
        this.db.select().from(schema.approvals).where(eq(schema.approvals.userId, this.userId)),
      ),
      outreachMessages: await collect(
        this.db.select().from(outreachMessages).where(eq(outreachMessages.userId, this.userId)),
      ),
      playbooks: await collect(
        this.db.select().from(schema.playbooks).where(eq(schema.playbooks.userId, this.userId)),
      ),
      playbookRuns: await collect(
        this.db.select().from(schema.playbookRuns).where(eq(schema.playbookRuns.userId, this.userId)),
      ),
      notifications: await this.listNotifications(10000),
      auditLog: await this.listAuditEntries(10000),
      invitesSent: await collect(
        this.db
          .select({ email: invites.email, createdAt: invites.createdAt, acceptedAt: invites.acceptedAt })
          .from(invites)
          .where(eq(invites.invitedBy, this.userId)),
      ),
      vaultEntries: await collect(
        this.db
          .select({ kind: vaultSecrets.kind, name: vaultSecrets.name, updatedAt: vaultSecrets.updatedAt })
          .from(vaultSecrets)
          .where(eq(vaultSecrets.userId, this.userId)),
      ),
      sessions: await collect(
        this.db
          .select({ createdAt: sessions.createdAt, ip: sessions.ip, userAgent: sessions.userAgent })
          .from(sessions)
          .where(eq(sessions.userId, this.userId)),
      ),
      previousExports: await collect(
        this.db.select().from(dataExports).where(eq(dataExports.userId, this.userId)),
      ),
      note: "Vault secret values are write-only and are never included in exports.",
    };
    await this.db.insert(dataExports).values({ userId: this.userId });
    return archive;
  }

  /**
   * Full account deletion. Cascading foreign keys remove every personal
   * row with the user; the search indexes are purged as well.
   */
  async deleteAccount() {
    await this.db.delete(users).where(eq(users.id, this.userId));
    await removeUserFromSearch(this.userId);
  }
}

export function scopeFor(userId: string): UserScope {
  return new UserScope(userId);
}
