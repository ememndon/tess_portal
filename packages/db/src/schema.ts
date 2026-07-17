import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Platform-level key/value records such as boot markers and schema
 * health probes.
 */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Identity and platform tables (Phase 1). Every table holding personal
 * data carries user_id, and every query on it goes through the scoped
 * data access layer, never raw.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    gateVersion: integer("gate_version").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

/** Single row, id fixed to 1. The universal gate credential. */
export const gateConfig = pgTable("gate_config", {
  id: integer("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  /** array of { code: string | null, name: string }; null code = manual mode */
  targetCountries: jsonb("target_countries").notNull().default([]),
  /** free-text roles the discovery firehose searches for (comma-separated), e.g. "Full Stack Developer, Software Engineer"; blank = derive from résumé */
  roleQuery: text("role_query"),
  /** only surface jobs with a sponsorship signal (default on) */
  requireSponsorship: boolean("require_sponsorship").notNull().default(true),
  /** rank family-reunification-friendly countries above the rest (default on) */
  requireFamilyReunification: boolean("require_family_reunification").notNull().default(true),
  theme: text("theme").notNull().default("dark"),
  /** private read-only calendar feed token; regenerable */
  icsToken: text("ics_token").unique(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Encrypted secrets. user_id null means a platform-level secret.
 * Values are AES-256-GCM ciphertext, write-only everywhere: no API or
 * UI ever returns the plaintext.
 */
export const vaultSecrets = pgTable(
  "vault_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    ciphertext: text("ciphertext").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("vault_scope_kind_name_uq").on(t.userId, t.kind, t.name).nullsNotDistinct(),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt)],
);

/**
 * Audit trail. user_id is the actor; null marks a system record that
 * must outlive its actor (for example the record of an account
 * deletion). Personal entries cascade away with their owner.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** frozen content snapshot of exactly what happened */
    snapshot: jsonb("snapshot"),
    ip: text("ip"),
    /** true for system-scope actions shown in the admin system log */
    system: boolean("system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_user_idx").on(t.userId, t.createdAt),
    index("audit_system_idx").on(t.system, t.createdAt),
  ],
);

export const dataExports = pgTable("data_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ===================================================================
 * Phase 2: jobs and companies, documents and applications, people and
 * outreach, interviews and offers, agent, cost and models, calendar.
 * Personal tables all carry user_id; access goes through the DAL.
 * =================================================================== */

import { date, numeric, vector } from "drizzle-orm/pg-core";

/* ---------- jobs and companies ---------- */

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    website: text("website"),
    countryCode: text("country_code"),
    sponsorStatus: text("sponsor_status").notNull().default("unknown"),
    brief: jsonb("brief"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("companies_user_idx").on(t.userId)],
);

export const companyWatchlist = pgTable(
  "company_watchlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("watchlist_user_company_uq").on(t.userId, t.companyId)],
);

export const JOB_STAGES = [
  "saved",
  "researching",
  "applied",
  "outreach",
  "interview",
  "offer",
  "rejected",
  "ghosted",
] as const;

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    companyName: text("company_name").notNull().default(""),
    location: text("location"),
    countryCode: text("country_code"),
    remote: text("remote"),
    url: text("url"),
    source: text("source").notNull().default("manual"),
    market: text("market"),
    description: text("description"),
    salaryRaw: text("salary_raw"),
    salaryMin: numeric("salary_min"),
    salaryMax: numeric("salary_max"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period"),
    sponsorship: text("sponsorship").notNull().default("unknown"),
    stage: text("stage").notNull().default("saved"),
    matchScore: integer("match_score"),
    matchExplanation: jsonb("match_explanation"),
    embedding: vector("embedding", { dimensions: 1536 }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /** false = discovered candidate (Discover, purged after 60 days);
     *  true = in the pipeline with a permanent snapshot */
    saved: boolean("saved").notNull().default(true),
    /** original posting date, drives freshness ranking */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    /** stable id from the source (ATS job id, RSS guid) for dedup */
    externalId: text("external_id"),
    /** normalized title+company fingerprint for cross-source dedup */
    fingerprint: text("fingerprint"),
    /** ghost-job and scam signals, labeled not verdicts */
    signals: jsonb("signals"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("jobs_user_stage_idx").on(t.userId, t.stage),
    index("jobs_user_saved_idx").on(t.userId, t.saved),
    index("jobs_fingerprint_idx").on(t.userId, t.fingerprint),
    index("jobs_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/** Full posting copy captured when the job is saved. Permanent. */
export const jobSnapshots = pgTable(
  "job_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    content: jsonb("content").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("job_snapshots_job_idx").on(t.jobId)],
);

/** Notes and every change, the per-job activity timeline. */
export const jobActivities = pgTable(
  "job_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("job_activities_job_idx").on(t.jobId, t.createdAt)],
);

/** Per-country source configuration. Data, not code. Global scope. */
export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  countryCode: text("country_code").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  config: jsonb("config"),
  proxyEnabled: boolean("proxy_enabled").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Imported sponsor register data per country. Global scope. */
export const sponsorRegistry = pgTable(
  "sponsor_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull(),
    companyName: text("company_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    registerData: jsonb("register_data"),
    importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("sponsor_registry_country_idx").on(t.countryCode, t.normalizedName),
    unique("sponsor_registry_country_name_uq").on(t.countryCode, t.normalizedName),
  ],
);

/**
 * Cache of sponsor-company → ATS board resolution. Each register company is
 * probed once for a public ATS board; a hit becomes a `sources` row (its id
 * kept here), a miss is remembered so it is not re-probed. Survives the weekly
 * register refresh, which replaces sponsor_registry wholesale.
 */
export const atsResolution = pgTable(
  "ats_resolution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countryCode: text("country_code").notNull(),
    normalizedName: text("normalized_name").notNull(),
    status: text("status").notNull(), // "resolved" | "miss"
    adapter: text("adapter"),
    config: jsonb("config"),
    sourceId: uuid("source_id"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("ats_resolution_country_name_uq").on(t.countryCode, t.normalizedName)],
);

/** Hiring signals per watched company. */
export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("signals_user_idx").on(t.userId)],
);

/* ---------- documents and applications ---------- */

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("other"),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("documents_user_idx").on(t.userId)],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    content: text("content_base64").notNull(),
    textContent: text("text_content"),
    note: text("note"),
    /** which job this version went to, the went-where link */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("document_versions_doc_idx").on(t.documentId, t.version)],
);

/** Parsed master profile and base CV variants, confirmed by the user. */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("master"),
    name: text("name").notNull().default("Master profile"),
    data: jsonb("data"),
    embedding: vector("embedding", { dimensions: 1536 }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("profiles_user_idx").on(t.userId),
    index("profiles_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    cvVersionId: uuid("cv_version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    coverLetterVersionId: uuid("cover_letter_version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    formAnswers: jsonb("form_answers"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("applications_user_idx").on(t.userId)],
);

export const workSamples = pgTable("work_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url"),
  description: text("description"),
  tags: jsonb("tags"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---------- people and outreach ---------- */

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    role: text("role"),
    companyName: text("company_name"),
    email: text("email"),
    linkedin: text("linkedin"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("contacts_user_idx").on(t.userId)],
);

export const outreachSequences = pgTable("outreach_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sequenceSteps = pgTable("sequence_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sequenceId: uuid("sequence_id")
    .notNull()
    .references(() => outreachSequences.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  kind: text("kind").notNull(),
  waitDays: integer("wait_days").notNull().default(0),
  status: text("status").notNull().default("pending"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/** Sent content snapshots live here word for word. */
export const outreachMessages = pgTable(
  "outreach_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    sequenceId: uuid("sequence_id").references(() => outreachSequences.id, {
      onDelete: "set null",
    }),
    channel: text("channel").notNull().default("email"),
    direction: text("direction").notNull().default("out"),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status").notNull().default("draft"),
    /** incoming: classification (reply|rejection|interview|other) */
    classification: text("classification"),
    /** provider message id for incoming dedup */
    externalId: text("external_id"),
    fromEmail: text("from_email"),
    toEmail: text("to_email"),
    /** A/B variant label this message used */
    variant: text("variant"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("outreach_messages_user_idx").on(t.userId),
    index("outreach_messages_ext_idx").on(t.userId, t.externalId),
  ],
);

export const linkClicks = pgTable("link_clicks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  url: text("url").notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  messageId: uuid("message_id").references(() => outreachMessages.id, { onDelete: "set null" }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  clickCount: integer("click_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messageExperiments = pgTable("message_experiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  variants: jsonb("variants"),
  results: jsonb("results"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---------- interviews and offers ---------- */

export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    round: text("round").notNull().default("Round 1"),
    medium: text("medium").notNull().default("video"),
    locationOrLink: text("location_or_link"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull().default(60),
    outcome: text("outcome"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("interviews_user_idx").on(t.userId, t.scheduledAt)],
);

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    baseSalary: numeric("base_salary"),
    currency: text("currency").notNull().default("EUR"),
    period: text("period").notNull().default("year"),
    bonus: text("bonus"),
    equity: text("equity"),
    benefits: text("benefits"),
    relocation: text("relocation"),
    deadline: date("deadline"),
    status: text("status").notNull().default("received"),
    notes: text("notes"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("offers_user_idx").on(t.userId)],
);

export const prepPacks = pgTable("prep_packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  interviewId: uuid("interview_id").references(() => interviews.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  content: jsonb("content"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const storyBank = pgTable(
  "story_bank",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    competency: text("competency").notNull(),
    situation: text("situation"),
    task: text("task"),
    action: text("action"),
    result: text("result"),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("story_bank_user_idx").on(t.userId),
    index("story_bank_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/* ---------- agent ---------- */

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New conversation"),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("messages_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const standingInstructions = pgTable("standing_instructions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  instruction: text("instruction").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const learnedProfile = pgTable("learned_profile", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Sensitive actions wait here. Frozen content snapshots, always. */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => [index("approvals_user_status_idx").on(t.userId, t.status)],
);

export const playbooks = pgTable("playbooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  trigger: text("trigger").notNull().default(""),
  category: text("category"),
  builtin: boolean("builtin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const playbookSteps = pgTable("playbook_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  playbookId: uuid("playbook_id")
    .notNull()
    .references(() => playbooks.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  instruction: text("instruction").notNull(),
  mode: text("mode").notNull().default("ask_first"),
});

export const playbookRuns = pgTable("playbook_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  playbookId: uuid("playbook_id")
    .notNull()
    .references(() => playbooks.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  stepLog: jsonb("step_log"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** The Jobs Monitor registry. user_id null marks platform tasks. */
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  schedule: text("schedule").notNull(),
  critical: boolean("critical").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastResult: text("last_result"),
  lastDurationMs: integer("last_duration_ms"),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  successCount: integer("success_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
});

export const taskRuns = pgTable(
  "task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: text("task_id")
      .notNull()
      .references(() => scheduledTasks.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    resultSummary: text("result_summary"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("task_runs_task_idx").on(t.taskId, t.startedAt)],
);

/* ---------- cost and models ---------- */

export const providers = pgTable("providers", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  chainOrder: integer("chain_order").notNull(),
  freeTier: boolean("free_tier").notNull().default(false),
  dailyLimits: jsonb("daily_limits"),
  enabled: boolean("enabled").notNull().default(true),
});

/** Activity to model table. Routing is configuration, not code. */
export const modelRouting = pgTable("model_routing", {
  activity: text("activity").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("usage_events_created_idx").on(t.createdAt)],
);

export const capConfig = pgTable("cap_config", {
  id: integer("id").primaryKey(),
  monthlyCapUsd: numeric("monthly_cap_usd").notNull().default("40"),
  alertAtPct: integer("alert_at_pct").notNull().default(80),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---------- calendar ---------- */

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("custom"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    location: text("location"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("calendar_events_user_idx").on(t.userId, t.startsAt)],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    leadMinutes: integer("lead_minutes").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("reminders_due_idx").on(t.sentAt, t.eventId)],
);

/* ---------- discovery ---------- */

/** Daily currency rates from frankfurter, base EUR, cached. */
export const currencyRates = pgTable(
  "currency_rates",
  {
    base: text("base").notNull(),
    target: text("target").notNull(),
    rate: numeric("rate").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.base, t.target] })],
);

/**
 * Pages watched for change: official immigration/visa pages and, later,
 * company news. Global scope. The monitor fetches on schedule, diffs
 * against the stored hash, and alerts every user on a change.
 */
export const monitoredPages = pgTable(
  "monitored_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    countryCode: text("country_code"),
    label: text("label").notNull(),
    url: text("url").notNull().unique(),
    contentHash: text("content_hash"),
    snapshot: text("snapshot"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("monitored_pages_kind_idx").on(t.kind)],
);

/**
 * Per-source discovery run history, feeds scraper health in admin.
 * Global scope: about sources, not personal data.
 */
export const discoveryRuns = pgTable(
  "discovery_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "cascade" }),
    sourceName: text("source_name").notNull(),
    status: text("status").notNull(),
    fetched: integer("fetched").notNull().default(0),
    error: text("error"),
    durationMs: integer("duration_ms"),
    ranAt: timestamp("ran_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("discovery_runs_source_idx").on(t.sourceId, t.ranAt)],
);

/* ===================================================================
 * Mailbox (Pattern B): the portal mirrors an external Hostinger (or any
 * IMAP/SMTP) account so the owner has a full inbox — folders, threads,
 * compose, search — inside the app. The mail server is the source of
 * truth; these tables are a cache/index. Credentials live in the vault
 * (user_imap / user_smtp), never here. Every table carries user_id and
 * is read through the scoped DAL.
 * =================================================================== */

/** One connected mailbox per user (v1). Non-secret transport metadata + sync state. */
export const mailAccounts = pgTable(
  "mail_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name"),
    imapHost: text("imap_host").notNull(),
    imapPort: integer("imap_port").notNull().default(993),
    smtpHost: text("smtp_host").notNull(),
    smtpPort: integer("smtp_port").notNull().default(465),
    /** login username; usually the full email address */
    username: text("username").notNull(),
    /** active | auth_failed | disabled */
    status: text("status").notNull().default("active"),
    /** true once the initial backfill window has completed */
    backfillDone: boolean("backfill_done").notNull().default(false),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** per-account signature, auto-inserted on compose/reply */
    signatureHtml: text("signature_html"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mail_accounts_user_idx").on(t.userId)],
);

/** Mirrors IMAP mailboxes. special_use maps Inbox/Sent/etc. regardless of name. */
export const mailFolders = pgTable(
  "mail_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** full IMAP path incl. delimiter, e.g. INBOX/Clients */
    path: text("path").notNull(),
    /** inbox | sent | drafts | trash | junk | archive | all | null (custom) */
    specialUse: text("special_use"),
    subscribed: boolean("subscribed").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    uidvalidity: text("uidvalidity"),
    uidnext: text("uidnext"),
    highestModseq: text("highest_modseq"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("mail_folders_account_path_uq").on(t.accountId, t.path),
    index("mail_folders_user_idx").on(t.userId, t.accountId),
  ],
);

/** One row per conversation; the list view reads threads, not messages. */
export const mailThreads = pgTable(
  "mail_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    /** normalized subject: Re:/Fwd: stripped */
    subject: text("subject"),
    snippet: text("snippet"),
    /** [{name,email}] deduped */
    participants: jsonb("participants").notNull().default([]),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mail_threads_list_idx").on(t.userId, t.accountId, t.lastMessageAt)],
);

/** One row per email. Bodies lazy-load (null until first opened). */
export const mailMessages = pgTable(
  "mail_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => mailFolders.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => mailThreads.id, { onDelete: "set null" }),
    /** IMAP UID within the folder */
    uid: text("uid"),
    messageIdHdr: text("message_id_hdr"),
    inReplyTo: text("in_reply_to"),
    referencesHdrs: text("references_hdrs").array(),
    fromAddr: jsonb("from_addr").notNull(),
    toAddrs: jsonb("to_addrs").notNull().default([]),
    ccAddrs: jsonb("cc_addrs").notNull().default([]),
    bccAddrs: jsonb("bcc_addrs").notNull().default([]),
    replyTo: jsonb("reply_to"),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    bodyFetched: boolean("body_fetched").notNull().default(false),
    isRead: boolean("is_read").notNull().default(false),
    isStarred: boolean("is_starred").notNull().default(false),
    isDraft: boolean("is_draft").notNull().default(false),
    isAnswered: boolean("is_answered").notNull().default(false),
    isForwarded: boolean("is_forwarded").notNull().default(false),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    sizeBytes: integer("size_bytes"),
    /** inbound | outbound */
    direction: text("direction").notNull().default("inbound"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    /** hidden from folder views until this time, then it resurfaces (snooze) */
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("mail_messages_folder_uid_uq").on(t.accountId, t.folderId, t.uid),
    index("mail_messages_folder_time_idx").on(t.folderId, t.receivedAt),
    index("mail_messages_thread_idx").on(t.threadId, t.sentAt),
    index("mail_messages_msgid_idx").on(t.accountId, t.messageIdHdr),
    index("mail_messages_user_idx").on(t.userId, t.accountId),
    index("mail_messages_snooze_idx").on(t.snoozedUntil),
  ],
);

/** Attachment metadata + bytes (base64, lazy). Kept in-DB like documents. */
export const mailAttachments = pgTable(
  "mail_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => mailMessages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** CID for inline images, e.g. <img1@compose> */
    contentId: text("content_id"),
    isInline: boolean("is_inline").notNull().default(false),
    /** base64 bytes; null until fetched with the body */
    content: text("content"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mail_attachments_message_idx").on(t.messageId)],
);

/** The send queue. UI writes a row; the worker sends and APPENDs to Sent. */
export const mailOutbox = pgTable(
  "mail_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    /** client-generated so a retried POST never double-sends */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    draftMessageId: uuid("draft_message_id").references(() => mailMessages.id, {
      onDelete: "set null",
    }),
    /** {to,cc,bcc,subject,html,text,attachmentIds,inReplyTo,references} */
    payload: jsonb("payload").notNull(),
    /** queued | sending | sent | failed | cancelled | scheduled */
    status: text("status").notNull().default("queued"),
    /** now()+undo delay, or the scheduled time */
    sendAfter: timestamp("send_after", { withTimezone: true }).defaultNow().notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentMessageId: uuid("sent_message_id").references(() => mailMessages.id, {
      onDelete: "set null",
    }),
    /** set when a row is claimed into 'sending'; the reaper reclaims stale ones */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** actual dispatch time; the per-hour rate limit counts these */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mail_outbox_due_idx").on(t.status, t.sendAfter)],
);

/** Gmail-style labels, orthogonal to folders. Included from v1 (retrofit is painful). */
export const mailLabels = pgTable(
  "mail_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#6b7280"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("mail_labels_account_name_uq").on(t.accountId, t.name)],
);

export const mailMessageLabels = pgTable(
  "mail_message_labels",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => mailMessages.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => mailLabels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.labelId] })],
);

/** Contacts harvested from mail traffic, powering To/Cc autocomplete. */
export const mailContacts = pgTable(
  "mail_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
    useCount: integer("use_count").notNull().default(1),
  },
  (t) => [unique("mail_contacts_user_email_uq").on(t.userId, t.email)],
);

/** Filters engine (applied on inbound). Table now; engine is a later phase. */
export const mailRules = pgTable("mail_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => mailAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  position: integer("position").notNull().default(100),
  /** {match:'all'|'any', rules:[{field,op,value}]} */
  conditions: jsonb("conditions").notNull(),
  /** [{type:'move',folderId}|{type:'label',labelId}|{type:'mark_read'}|{type:'star'}] */
  actions: jsonb("actions").notNull(),
  stopProcessing: boolean("stop_processing").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Autosaved compose drafts (server-side so they survive refresh/device). */
export const mailDrafts = pgTable(
  "mail_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toText: text("to_text").notNull().default(""),
    ccText: text("cc_text").notNull().default(""),
    bccText: text("bcc_text").notNull().default(""),
    subject: text("subject").notNull().default(""),
    html: text("html").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    plainMode: boolean("plain_mode").notNull().default(false),
    attachmentIds: jsonb("attachment_ids").notNull().default([]),
    inReplyTo: text("in_reply_to"),
    referencesHdr: text("references_hdr"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mail_drafts_user_idx").on(t.userId, t.updatedAt)],
);

/** Files uploaded in compose, referenced by an outbox send, then deleted. */
export const mailUploads = pgTable(
  "mail_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** base64 bytes */
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mail_uploads_user_idx").on(t.userId)],
);
