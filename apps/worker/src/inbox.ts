import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { Redis } from "ioredis";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import { decryptSecret, type Logger } from "@tessportal/shared";

const { vaultSecrets, users, outreachMessages, outreachSequences, contacts, jobs, jobActivities, notifications, approvals, appMeta } =
  schema;

/**
 * Per-user inbox monitoring. Polls each opted-in mailbox over IMAP,
 * classifies replies, rejections, and interview invitations, updates
 * the pipeline, drafts replies into the approval queue, and stops a
 * sequence the moment a reply arrives. The message-processing core is
 * separated so it is testable without a live mailbox.
 */

export type Classification = "rejection" | "interview" | "reply" | "other";

const REJECTION =
  /(unfortunately|regret to inform|not moving forward|decided not to (?:move|proceed)|other candidates|will not be proceeding|was unsuccessful|position (?:has been|is) filled|not (?:be )?progress|decided to go (?:with|in another))/i;
const INTERVIEW =
  /(schedule (?:a|an) (?:call|interview|chat)|book a time|your availability|available to (?:meet|chat|talk)|next steps|invite you to|would (?:love|like) to (?:chat|meet|talk)|hop on a call|set up (?:a|an) (?:call|interview)|arrange (?:a|an) interview)/i;

export function classifyEmail(subject: string, text: string): Classification {
  const hay = `${subject}\n${text}`;
  if (REJECTION.test(hay)) return "rejection";
  if (INTERVIEW.test(hay)) return "interview";
  return "reply";
}

export type IncomingEmail = {
  externalId: string;
  fromEmail: string;
  subject: string;
  text: string;
  date: Date;
};

/**
 * Processes one incoming email: dedup, match to a prior outreach and
 * its job, record it, classify, and act. Returns what happened.
 */
export async function processIncoming(
  db: Db,
  redis: Redis,
  log: Logger,
  userId: string,
  email: IncomingEmail,
): Promise<{ classification: Classification; matched: boolean; action: string } | null> {
  // dedup by provider message id
  const dupe = await db
    .select({ id: outreachMessages.id })
    .from(outreachMessages)
    .where(and(eq(outreachMessages.userId, userId), eq(outreachMessages.externalId, email.externalId)))
    .limit(1);
  if (dupe[0]) return null;

  const from = email.fromEmail.toLowerCase();
  // match to the most recent outbound outreach to this address (or a
  // contact with this email), so the reply attaches to the right job
  const [match] = await db
    .select({ jobId: outreachMessages.jobId, contactId: outreachMessages.contactId, sequenceId: outreachMessages.sequenceId })
    .from(outreachMessages)
    .leftJoin(contacts, eq(contacts.id, outreachMessages.contactId))
    .where(
      and(
        eq(outreachMessages.userId, userId),
        eq(outreachMessages.direction, "out"),
        or(sql`lower(${outreachMessages.toEmail}) = ${from}`, sql`lower(${contacts.email}) = ${from}`),
      ),
    )
    .orderBy(desc(outreachMessages.createdAt))
    .limit(1);

  const classification = classifyEmail(email.subject, email.text);

  await db.insert(outreachMessages).values({
    userId,
    contactId: match?.contactId ?? null,
    jobId: match?.jobId ?? null,
    sequenceId: match?.sequenceId ?? null,
    channel: "email",
    direction: "in",
    subject: email.subject.slice(0, 300),
    body: email.text.slice(0, 20000),
    classification,
    externalId: email.externalId,
    fromEmail: email.fromEmail,
    status: "received",
    sentAt: email.date,
  });

  const notify = async (title: string, body: string, href: string) => {
    const [n] = await db
      .insert(notifications)
      .values({ userId, type: `inbox.${classification}`, title, body, href })
      .returning();
    await redis
      .publish(`notify:${userId}`, JSON.stringify({ unread: 1, notification: { id: n.id, title, type: n.type } }))
      .catch(() => {});
  };

  let action = "recorded";

  // any inbound reply stops an active sequence to that contact
  if (match?.contactId) {
    const stopped = await db
      .update(outreachSequences)
      .set({ status: `stopped:reply` })
      .where(
        and(
          eq(outreachSequences.userId, userId),
          eq(outreachSequences.contactId, match.contactId),
          eq(outreachSequences.status, "active"),
        ),
      )
      .returning({ id: outreachSequences.id });
    if (stopped.length > 0) action = "stopped_sequence";
  }

  if (classification === "rejection" && match?.jobId) {
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, match.jobId), eq(jobs.userId, userId)))
      .limit(1);
    if (job && job.stage !== "rejected") {
      await db.update(jobs).set({ stage: "rejected", updatedAt: new Date() }).where(eq(jobs.id, job.id));
      await db.insert(jobActivities).values({
        userId,
        jobId: job.id,
        type: "stage_changed",
        payload: { from: job.stage, to: "rejected", reason: "email rejection detected" },
      });
      action = "moved_to_rejected";
      await notify(
        `Rejection from ${job.companyName || email.fromEmail}`,
        `Moved ${job.title} to Rejected.`,
        `/pipeline/${job.id}`,
      );
    }
  } else if (classification === "interview" && match?.jobId) {
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, match.jobId), eq(jobs.userId, userId)))
      .limit(1);
    // draft a reply routed to approval; sending stays gated
    await db.insert(approvals).values({
      userId,
      kind: "outreach.send",
      title: `Reply to interview invite from ${email.fromEmail}`,
      summary: "Draft acceptance reply, edit before sending.",
      payload: {
        toEmail: email.fromEmail,
        subject: `Re: ${email.subject}`.slice(0, 300),
        body: `Thank you for the invitation. I would be glad to meet. I am generally available weekday mornings and early afternoons, but happy to work around your schedule, just send a few options and I will confirm.\n\nBest regards`,
        jobId: match.jobId,
        contactId: match.contactId,
      },
    });
    if (job && ["saved", "researching", "applied", "outreach"].includes(job.stage)) {
      await db.update(jobs).set({ stage: "interview", updatedAt: new Date() }).where(eq(jobs.id, job.id));
      await db.insert(jobActivities).values({
        userId,
        jobId: job.id,
        type: "stage_changed",
        payload: { from: job.stage, to: "interview", reason: "interview invite detected" },
      });
    }
    action = "interview_reply_drafted";
    await notify(
      `Interview invite from ${email.fromEmail}`,
      "A draft reply is waiting for your approval.",
      "/notifications",
    );
  } else {
    await notify(`New reply from ${email.fromEmail}`, email.subject, match?.jobId ? `/pipeline/${match.jobId}` : "/outreach");
  }

  log.info({ user: userId, classification, action }, "processed incoming email");
  return { classification, matched: Boolean(match), action };
}

async function getUserImap(db: Db, userId: string) {
  const rows = await db
    .select({ ciphertext: vaultSecrets.ciphertext })
    .from(vaultSecrets)
    .where(and(eq(vaultSecrets.userId, userId), eq(vaultSecrets.kind, "user_imap"), eq(vaultSecrets.name, "default")))
    .limit(1);
  if (!rows[0]) return null;
  const master = process.env.VAULT_MASTER_KEY;
  if (!master) return null;
  try {
    const cfg = JSON.parse(decryptSecret(master, rows[0].ciphertext)) as {
      host: string;
      port: number | string;
      secure?: boolean | string;
      user: string;
      pass: string;
    };
    return {
      host: cfg.host,
      port: Number(cfg.port),
      secure: cfg.secure === undefined ? Number(cfg.port) === 993 : String(cfg.secure) !== "false",
      auth: { user: cfg.user, pass: cfg.pass },
    };
  } catch {
    return null;
  }
}

async function pollUserInbox(db: Db, redis: Redis, log: Logger, userId: string): Promise<number> {
  const cfg = await getUserImap(db, userId);
  if (!cfg) return 0;

  const markerKey = `inbox.lastseen:${userId}`;
  const marker = await db.select().from(appMeta).where(eq(appMeta.key, markerKey)).limit(1);
  const since = (marker[0]?.value as { at?: string } | null)?.at
    ? new Date((marker[0]!.value as { at: string }).at)
    : new Date(Date.now() - 3 * 24 * 3600 * 1000);

  const client = new ImapFlow({ ...cfg, logger: false, socketTimeout: 20000 });
  let processed = 0;
  let newest = since;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const msg of client.fetch({ since }, { source: true, envelope: true })) {
        const parsed = await simpleParser(msg.source as Buffer);
        const date = parsed.date ?? new Date();
        if (date <= since) continue;
        const fromEmail = parsed.from?.value?.[0]?.address ?? "";
        if (!fromEmail) continue;
        const result = await processIncoming(db, redis, log, userId, {
          externalId: parsed.messageId ?? `${fromEmail}:${date.getTime()}`,
          fromEmail,
          subject: parsed.subject ?? "",
          text: parsed.text ?? parsed.html?.toString().replace(/<[^>]+>/g, " ") ?? "",
          date,
        });
        if (result) processed += 1;
        if (date > newest) newest = date;
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    log.warn({ user: userId, err: (err as Error).message }, "inbox poll failed");
    client.close();
    return 0;
  }

  await db
    .insert(appMeta)
    .values({ key: markerKey, value: { at: newest.toISOString() } })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: { at: newest.toISOString() }, updatedAt: new Date() } });
  return processed;
}

/** Scheduled task: poll every opted-in user's mailbox. */
export async function pollAllInboxes(db: Db, redis: Redis, log: Logger): Promise<string> {
  const optedIn = await db
    .selectDistinct({ userId: vaultSecrets.userId })
    .from(vaultSecrets)
    .where(and(isNotNull(vaultSecrets.userId), eq(vaultSecrets.kind, "user_imap")));
  if (optedIn.length === 0) return "no connected mailboxes";
  let total = 0;
  for (const row of optedIn) {
    if (!row.userId) continue;
    total += await pollUserInbox(db, redis, log, row.userId);
  }
  return `polled ${optedIn.length} mailbox${optedIn.length === 1 ? "" : "es"}, ${total} new message${total === 1 ? "" : "s"}`;
}

/** Builds a plain-text follow-up draft for a due sequence step. */
export function followupDraft(o: {
  contactName: string | null;
  jobTitle: string | null;
  jobCompany: string | null;
  userName: string;
}): { subject: string; body: string } {
  const first = (o.contactName ?? "").trim().split(/\s+/)[0] || "there";
  const roleBit = o.jobTitle ? ` about the ${o.jobTitle} role${o.jobCompany ? ` at ${o.jobCompany}` : ""}` : "";
  const subject = o.jobTitle
    ? `Following up on the ${o.jobTitle} role${o.jobCompany ? ` at ${o.jobCompany}` : ""}`
    : "Following up";
  const body = [
    `Hi ${first},`,
    "",
    `I wanted to follow up on my earlier note${roleBit}. I am still very interested and would welcome the chance to talk whenever suits you.`,
    "",
    "Happy to share anything that would help, and thanks again for your time.",
    "",
    "Best,",
    o.userName || "",
  ]
    .join("\n")
    .trimEnd();
  return { subject: subject.slice(0, 300), body };
}

/**
 * Scheduled task: act on due sequence steps. Email steps to a contact
 * with an address become a pre-filled outreach.send approval the user
 * can approve to send from their own mailbox; everything else stays a
 * reminder. Sending is never automatic — it always goes through approval.
 */
export async function runSequencer(db: Db, redis: Redis, log: Logger): Promise<string> {
  const due = await db
    .select({
      step: schema.sequenceSteps,
      seqName: outreachSequences.name,
      seqId: outreachSequences.id,
      jobId: outreachSequences.jobId,
      contactId: outreachSequences.contactId,
      userId: outreachSequences.userId,
      contactEmail: contacts.email,
      contactName: contacts.name,
      jobTitle: jobs.title,
      jobCompany: jobs.companyName,
    })
    .from(schema.sequenceSteps)
    .innerJoin(outreachSequences, eq(outreachSequences.id, schema.sequenceSteps.sequenceId))
    .leftJoin(contacts, eq(contacts.id, outreachSequences.contactId))
    .leftJoin(jobs, eq(jobs.id, outreachSequences.jobId))
    .where(
      and(
        eq(outreachSequences.status, "active"),
        or(eq(schema.sequenceSteps.status, "pending"), eq(schema.sequenceSteps.status, "scheduled")),
        sql`${schema.sequenceSteps.dueAt} <= now()`,
      ),
    )
    .limit(50);

  const nameCache = new Map<string, string>();
  const userName = async (userId: string): Promise<string> => {
    if (nameCache.has(userId)) return nameCache.get(userId)!;
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    const name = (u?.name ?? "").trim();
    nameCache.set(userId, name);
    return name;
  };

  let queued = 0;
  let reminded = 0;
  for (const row of due) {
    await db
      .update(schema.sequenceSteps)
      .set({ status: "notified", completedAt: new Date() })
      .where(eq(schema.sequenceSteps.id, row.step.id));

    const isEmailStep = row.step.kind === "email" || row.step.kind === "follow_up";
    let title: string;
    let body: string;
    let href: string;
    let type: string;

    if (isEmailStep && row.contactEmail) {
      // pre-fill a real send and route it to approval; nothing sends on its own
      const draft = followupDraft({
        contactName: row.contactName,
        jobTitle: row.jobTitle,
        jobCompany: row.jobCompany,
        userName: await userName(row.userId),
      });
      await db.insert(approvals).values({
        userId: row.userId,
        kind: "outreach.send",
        title: `Follow-up to ${row.contactName || row.contactEmail}`,
        summary: `Sequence "${row.seqName}", step ${row.step.position + 1}. Subject: ${draft.subject}`,
        payload: {
          toEmail: row.contactEmail,
          subject: draft.subject,
          body: draft.body,
          jobId: row.jobId,
          contactId: row.contactId,
          sequenceId: row.seqId,
        },
      });
      title = `Follow-up ready to send: ${row.seqName}`;
      body = `Approve to send from your mailbox, or edit first.`;
      href = "/notifications";
      type = "sequence.followup";
      queued += 1;
    } else {
      title = `Follow-up due: ${row.seqName}`;
      body = `Step ${row.step.position + 1} (${row.step.kind}) is due.`;
      href = row.jobId ? `/pipeline/${row.jobId}` : "/outreach";
      type = "sequence.followup";
      reminded += 1;
    }

    const [n] = await db.insert(notifications).values({ userId: row.userId, type, title, body, href }).returning();
    await redis
      .publish(`notify:${row.userId}`, JSON.stringify({ unread: 1, notification: { id: n.id, title: n.title, type: n.type } }))
      .catch(() => {});
  }
  log.info({ queued, reminded }, "sequencer run");
  const total = queued + reminded;
  if (total === 0) return "no follow-ups due";
  const bits: string[] = [];
  if (queued) bits.push(`${queued} follow-up${queued === 1 ? "" : "s"} queued for approval`);
  if (reminded) bits.push(`${reminded} reminder${reminded === 1 ? "" : "s"}`);
  return bits.join(", ");
}
