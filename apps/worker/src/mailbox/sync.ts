import { simpleParser, type AddressObject, type EmailAddress } from "mailparser";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { getMailContext, openImap, discoverFolders, type MailContext } from "./imap";
import { actionsForMessage, type MailForRules, type StoredRule } from "./rules";
import type { ImapFlow } from "imapflow";

/**
 * IMAP sync engine. The mail server is the source of truth; this mirrors
 * it into mail_messages / mail_threads. Backfill fetches the recent
 * window newest-first (envelopes + flags only — bodies are lazy),
 * incremental sync pulls UIDs at/above the stored uidnext and re-syncs
 * flags for the recent window, and bodies download on demand when a
 * message is first opened.
 */

const BACKFILL_WINDOW = 300; // most recent messages per folder on first sync
const FLAG_WINDOW = 200; // re-check flags for the newest N uids each pass

type Addr = { name?: string; address: string };

function toAddrs(a?: AddressObject | AddressObject[]): Addr[] {
  if (!a) return [];
  const list = Array.isArray(a) ? a : [a];
  const out: Addr[] = [];
  for (const group of list) {
    for (const v of group.value ?? []) {
      const e = v as EmailAddress;
      if (e.address) out.push({ name: e.name || undefined, address: e.address.toLowerCase() });
    }
  }
  return out;
}

/** imapflow EmailAddress[] (from envelope) → our shape. */
function fromEnvelope(list?: { name?: string; address?: string }[]): Addr[] {
  return (list ?? [])
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || undefined, address: (a.address as string).toLowerCase() }));
}

export function normalizeSubject(s?: string | null): string {
  return (s ?? "")
    .replace(/^(\s*(re|fwd?|aw|sv|rif)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .trim();
}

function parseReferences(headerBuf?: Buffer): string[] {
  if (!headerBuf) return [];
  const text = headerBuf.toString();
  const m = text.match(/<[^>]+>/g);
  return m ? m.slice(-25) : [];
}

function toDate(x: Date | string | number | null | undefined): Date | null {
  if (x === null || x === undefined || x === "") return null;
  const d = x instanceof Date ? x : new Date(x);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dedupeParticipants(addrs: Addr[]): Addr[] {
  const seen = new Map<string, Addr>();
  for (const a of addrs) if (a.address && !seen.has(a.address)) seen.set(a.address, a);
  return [...seen.values()].slice(0, 8);
}

function hasAttachmentsFrom(structure: unknown): boolean {
  const node = structure as { disposition?: string; childNodes?: unknown[]; type?: string } | null;
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  if (node.childNodes) return node.childNodes.some((c) => hasAttachmentsFrom(c));
  const t = (node.type ?? "").toLowerCase();
  return !!t && !t.startsWith("text/") && !t.startsWith("multipart/");
}

type EnvelopeMsg = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string | null;
  from: Addr[];
  to: Addr[];
  cc: Addr[];
  sentAt: Date | null;
};

async function threadFor(
  db: Db,
  userId: string,
  accountId: string,
  msg: EnvelopeMsg,
): Promise<string> {
  const ids = [...msg.references, ...(msg.inReplyTo ? [msg.inReplyTo] : [])].filter(Boolean);
  if (ids.length) {
    const [hit] = await db
      .select({ threadId: schema.mailMessages.threadId })
      .from(schema.mailMessages)
      .where(
        and(
          eq(schema.mailMessages.accountId, accountId),
          inArray(schema.mailMessages.messageIdHdr, ids),
          isNotNull(schema.mailMessages.threadId),
        ),
      )
      .limit(1);
    if (hit?.threadId) return hit.threadId;
  }
  if (msg.messageId) {
    const [hit] = await db
      .select({ threadId: schema.mailMessages.threadId })
      .from(schema.mailMessages)
      .where(
        and(
          eq(schema.mailMessages.accountId, accountId),
          sql`${schema.mailMessages.referencesHdrs} @> ARRAY[${msg.messageId}]::text[]`,
          isNotNull(schema.mailMessages.threadId),
        ),
      )
      .limit(1);
    if (hit?.threadId) return hit.threadId;
  }
  const base = normalizeSubject(msg.subject);
  if (base && !msg.inReplyTo) {
    const [hit] = await db
      .select({ id: schema.mailThreads.id })
      .from(schema.mailThreads)
      .where(
        and(
          eq(schema.mailThreads.accountId, accountId),
          eq(schema.mailThreads.subject, base),
          gt(schema.mailThreads.lastMessageAt, new Date(Date.now() - 14 * 86400000)),
        ),
      )
      .limit(1);
    if (hit) return hit.id;
  }
  const [t] = await db
    .insert(schema.mailThreads)
    .values({
      userId,
      accountId,
      subject: base || msg.subject || null,
      participants: dedupeParticipants([...msg.from, ...msg.to, ...msg.cc]),
      lastMessageAt: msg.sentAt ?? new Date(),
    })
    .returning({ id: schema.mailThreads.id });
  return t.id;
}

async function bumpThread(db: Db, threadId: string, msg: EnvelopeMsg): Promise<void> {
  // cast the bound Date explicitly — inside greatest() Postgres can't infer the
  // param type from the column and would otherwise treat it as text and error.
  const when = (msg.sentAt ?? new Date()).toISOString();
  await db
    .update(schema.mailThreads)
    .set({
      lastMessageAt: sql`greatest(${schema.mailThreads.lastMessageAt}, ${when}::timestamptz)`,
    })
    .where(eq(schema.mailThreads.id, threadId));
}

/** Upserts harvested addresses into mail_contacts (powers compose autocomplete). */
async function harvestContacts(db: Db, userId: string, addrs: Addr[]): Promise<void> {
  const seen = new Map<string, Addr>();
  for (const a of addrs) {
    const email = a.address?.toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (!seen.has(email)) seen.set(email, { name: a.name, address: email });
  }
  for (const a of seen.values()) {
    await db
      .insert(schema.mailContacts)
      .values({ userId, email: a.address, name: a.name ?? null })
      .onConflictDoUpdate({
        target: [schema.mailContacts.userId, schema.mailContacts.email],
        set: {
          name: sql`coalesce(${schema.mailContacts.name}, excluded.name)`,
          useCount: sql`${schema.mailContacts.useCount} + 1`,
          lastUsedAt: new Date(),
        },
      });
  }
}

/** Loads a user's enabled filter rules (position order) for the account. */
async function loadRules(db: Db, userId: string, accountId: string): Promise<StoredRule[]> {
  const rows = await db
    .select()
    .from(schema.mailRules)
    .where(and(eq(schema.mailRules.userId, userId), eq(schema.mailRules.accountId, accountId)))
    .orderBy(asc(schema.mailRules.position));
  return rows.map((r) => ({
    id: r.id,
    enabled: r.enabled,
    position: r.position,
    stopProcessing: r.stopProcessing,
    conditions: r.conditions as StoredRule["conditions"],
    actions: r.actions as StoredRule["actions"],
  }));
}

type NewInbound = { dbId: string; uid: number; msg: MailForRules };

/**
 * Applies filter-rule actions to freshly-arrived INBOX messages, using the
 * already-open mailbox connection. Flags (\Seen/\Flagged) are set on the
 * server so the flag-resync reads them straight back; moves relocate the
 * UID and drop the local row so the destination folder re-inserts it.
 */
async function applyRulesToNew(
  db: Db,
  log: Logger,
  client: ImapFlow,
  userId: string,
  rules: StoredRule[],
  incoming: NewInbound[],
): Promise<void> {
  if (rules.length === 0 || incoming.length === 0) return;
  // resolve folderId -> path and the trash path once
  const folders = await db
    .select({ id: schema.mailFolders.id, path: schema.mailFolders.path, special: schema.mailFolders.specialUse })
    .from(schema.mailFolders)
    .where(eq(schema.mailFolders.userId, userId));
  const pathById = new Map(folders.map((f) => [f.id, f.path]));
  const trashPath = folders.find((f) => f.special === "trash")?.path ?? null;

  const markRead: number[] = [];
  const markStar: number[] = [];

  for (const item of incoming) {
    const { actions } = actionsForMessage(rules, item.msg);
    if (actions.length === 0) continue;
    let moved = false;
    for (const a of actions) {
      if (a.type === "mark_read") markRead.push(item.uid);
      else if (a.type === "star") markStar.push(item.uid);
      else if (!moved && (a.type === "move" || a.type === "trash")) {
        const target = a.type === "trash" ? trashPath : pathById.get(a.folderId) ?? null;
        if (target) {
          try {
            await client.messageMove(String(item.uid), target, { uid: true });
            await db.delete(schema.mailMessages).where(eq(schema.mailMessages.id, item.dbId));
            moved = true;
          } catch (err) {
            log.warn({ err: (err as Error).message }, "rule move failed");
          }
        }
      }
    }
    // flags only matter for messages still in the inbox
    if (!moved) {
      const flagActions = actions.filter((a) => a.type === "mark_read" || a.type === "star");
      if (flagActions.some((a) => a.type === "mark_read"))
        await db.update(schema.mailMessages).set({ isRead: true }).where(eq(schema.mailMessages.id, item.dbId));
      if (flagActions.some((a) => a.type === "star"))
        await db.update(schema.mailMessages).set({ isStarred: true }).where(eq(schema.mailMessages.id, item.dbId));
    }
  }

  try {
    if (markRead.length) await client.messageFlagsAdd(markRead.join(","), ["\\Seen"], { uid: true });
    if (markStar.length) await client.messageFlagsAdd(markStar.join(","), ["\\Flagged"], { uid: true });
  } catch (err) {
    log.warn({ err: (err as Error).message }, "rule flag write-back failed");
  }
}

/** Incremental (and backfill) sync of one folder. Returns messages inserted. */
export async function syncFolder(
  db: Db,
  log: Logger,
  ctx: MailContext,
  folder: typeof schema.mailFolders.$inferSelect,
  opts: { backfill?: boolean } = {},
): Promise<number> {
  const client = openImap(ctx.imap);
  let inserted = 0;
  try {
    await client.connect();
    const box = await client.mailboxOpen(folder.path, { readOnly: false });
    const serverUidValidity = String(box.uidValidity);

    // UIDVALIDITY changed → our cached UIDs are garbage; wipe + resync
    if (folder.uidvalidity && folder.uidvalidity !== serverUidValidity) {
      await db.delete(schema.mailMessages).where(eq(schema.mailMessages.folderId, folder.id));
      folder = { ...folder, uidnext: null };
    }

    // Which UIDs to pull
    let range: string | null = null;
    if (opts.backfill || !folder.uidnext) {
      const total = box.exists;
      if (total > 0) {
        const startSeq = Math.max(1, total - BACKFILL_WINDOW + 1);
        // sequence range → resolve to UIDs via fetch (uid:true returns uids)
        range = `${startSeq}:*`;
      }
    } else {
      range = `${folder.uidnext}:*`; // UID range for new mail
    }

    // Filter rules run on genuinely new INBOX arrivals only (not backfill/Sent).
    const applyRules = !opts.backfill && !!folder.uidnext && folder.specialUse === "inbox";
    const rules = applyRules ? await loadRules(db, ctx.account.userId, ctx.account.id) : [];
    const newInbound: NewInbound[] = [];
    const contactCandidates: Addr[] = [];

    if (range) {
      const useUid = !opts.backfill && !!folder.uidnext; // backfill uses sequence nums
      for await (const m of client.fetch(
        range,
        {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          internalDate: true,
          size: true,
          headers: ["references"],
        },
        { uid: useUid },
      )) {
        // one malformed message must never abort the whole folder sync
        try {
          // skip messages we already have — re-running threadFor on an existing
          // message would leak an orphan thread each pass (subject-match has a
          // 14-day window). Flags for existing messages are handled below.
          const uidStr = String(m.uid);
          const [dup] = await db
            .select({ id: schema.mailMessages.id })
            .from(schema.mailMessages)
            .where(
              and(
                eq(schema.mailMessages.accountId, ctx.account.id),
                eq(schema.mailMessages.folderId, folder.id),
                eq(schema.mailMessages.uid, uidStr),
              ),
            )
            .limit(1);
          if (dup) continue;

          const env = m.envelope;
          const references = parseReferences(m.headers as Buffer | undefined);
          const emsg: EnvelopeMsg = {
            messageId: env?.messageId ?? null,
            inReplyTo: env?.inReplyTo ?? null,
            references,
            subject: env?.subject ?? null,
            from: fromEnvelope(env?.from),
            to: fromEnvelope(env?.to),
            cc: fromEnvelope(env?.cc),
            sentAt: toDate(env?.date) ?? toDate(m.internalDate) ?? null,
          };
          const threadId = await threadFor(db, ctx.account.userId, ctx.account.id, emsg);
          const flags = m.flags ?? new Set<string>();
          const isSent = folder.specialUse === "sent";
          const hasAtt = hasAttachmentsFrom(m.bodyStructure);
          const res = await db
            .insert(schema.mailMessages)
            .values({
              userId: ctx.account.userId,
              accountId: ctx.account.id,
              folderId: folder.id,
              threadId,
              uid: String(m.uid),
              messageIdHdr: emsg.messageId,
              inReplyTo: emsg.inReplyTo,
              referencesHdrs: references.length ? references : null,
              fromAddr: emsg.from[0] ?? { address: "" },
              toAddrs: emsg.to,
              ccAddrs: emsg.cc,
              subject: emsg.subject,
              isRead: flags.has("\\Seen"),
              isStarred: flags.has("\\Flagged"),
              isAnswered: flags.has("\\Answered"),
              isDraft: flags.has("\\Draft"),
              hasAttachments: hasAtt,
              sizeBytes: m.size ?? null,
              direction: isSent ? "outbound" : "inbound",
              sentAt: emsg.sentAt,
              receivedAt: toDate(m.internalDate) ?? emsg.sentAt ?? new Date(),
            })
            .onConflictDoNothing({
              target: [schema.mailMessages.accountId, schema.mailMessages.folderId, schema.mailMessages.uid],
            })
            .returning({ id: schema.mailMessages.id });
          if (res[0]) {
            inserted += 1;
            // harvest contacts: who wrote to us (inbound) / who we wrote to (sent)
            if (isSent) contactCandidates.push(...emsg.to, ...emsg.cc);
            else contactCandidates.push(...emsg.from);
            if (applyRules) {
              newInbound.push({
                dbId: res[0].id,
                uid: m.uid,
                msg: { from: emsg.from, to: emsg.to, cc: emsg.cc, subject: emsg.subject, hasAttachments: hasAtt },
              });
            }
            await bumpThread(db, threadId, emsg);
          }
        } catch (err) {
          log.warn({ folder: folder.path, uid: m.uid, err: (err as Error).message }, "message sync skipped");
        }
      }
    }

    if (contactCandidates.length) await harvestContacts(db, ctx.account.userId, contactCandidates);
    if (applyRules) await applyRulesToNew(db, log, client, ctx.account.userId, rules, newInbound);

    // Flag re-sync for the recent window (cheap CONDSTORE-free approach)
    const total = box.exists;
    if (total > 0) {
      const startSeq = Math.max(1, total - FLAG_WINDOW + 1);
      for await (const m of client.fetch(`${startSeq}:*`, { uid: true, flags: true })) {
        const flags = m.flags ?? new Set<string>();
        await db
          .update(schema.mailMessages)
          .set({
            isRead: flags.has("\\Seen"),
            isStarred: flags.has("\\Flagged"),
            isAnswered: flags.has("\\Answered"),
          })
          .where(
            and(
              eq(schema.mailMessages.folderId, folder.id),
              eq(schema.mailMessages.uid, String(m.uid)),
            ),
          );
      }
    }

    await db
      .update(schema.mailFolders)
      .set({
        uidvalidity: serverUidValidity,
        uidnext: String(box.uidNext),
        lastSyncedAt: new Date(),
      })
      .where(eq(schema.mailFolders.id, folder.id));

    await client.logout();
  } catch (err) {
    log.warn({ folder: folder.path, err: (err as Error).message }, "folder sync failed");
    client.close();
    return inserted;
  }
  return inserted;
}

/** Full account sync: discover folders, then sync INBOX, Sent, and the rest. */
export async function syncAccount(
  db: Db,
  log: Logger,
  userId: string,
  opts: { backfill?: boolean } = {},
): Promise<number> {
  const ctx = await getMailContext(db, userId);
  if (!ctx) return 0;
  await discoverFolders(db, log, userId);
  const folders = await db
    .select()
    .from(schema.mailFolders)
    .where(eq(schema.mailFolders.userId, userId));
  // sync order: inbox, sent (for reply threading), then others
  const rank = (f: (typeof folders)[number]) =>
    f.specialUse === "inbox" ? 0 : f.specialUse === "sent" ? 1 : 2;
  folders.sort((a, b) => rank(a) - rank(b));

  let total = 0;
  for (const folder of folders) {
    if (folder.specialUse === null && opts.backfill) {
      // on backfill, skip large custom folders beyond the standard set for speed;
      // they still sync incrementally afterwards
    }
    total += await syncFolder(db, log, ctx, folder, opts);
  }
  if (opts.backfill) {
    await db
      .update(schema.mailAccounts)
      .set({ backfillDone: true, lastSyncAt: new Date(), lastError: null })
      .where(eq(schema.mailAccounts.id, ctx.account.id));
  } else {
    await db
      .update(schema.mailAccounts)
      .set({ lastSyncAt: new Date() })
      .where(eq(schema.mailAccounts.id, ctx.account.id));
  }
  return total;
}

/** Downloads and stores a message body + attachments on first open. */
export async function fetchBody(db: Db, log: Logger, userId: string, messageId: string): Promise<void> {
  const [msg] = await db
    .select()
    .from(schema.mailMessages)
    .where(and(eq(schema.mailMessages.id, messageId), eq(schema.mailMessages.userId, userId)))
    .limit(1);
  if (!msg || msg.bodyFetched || !msg.uid) return;
  const [folder] = await db
    .select()
    .from(schema.mailFolders)
    .where(eq(schema.mailFolders.id, msg.folderId))
    .limit(1);
  if (!folder) return;
  const ctx = await getMailContext(db, userId);
  if (!ctx) return;

  const client = openImap(ctx.imap);
  try {
    await client.connect();
    await client.mailboxOpen(folder.path, { readOnly: true });
    const dl = await client.download(msg.uid, undefined, { uid: true });
    if (!dl) {
      await client.logout();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of dl.content) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const parsed = await simpleParser(raw);

    const bodyHtml = parsed.html || (parsed.textAsHtml ?? null);
    const bodyText = parsed.text ?? "";
    await db
      .update(schema.mailMessages)
      .set({
        bodyHtml: bodyHtml || null,
        bodyText: bodyText || null,
        bodyFetched: true,
        replyTo: toAddrs(parsed.replyTo)[0] ?? null,
      })
      .where(eq(schema.mailMessages.id, msg.id));

    // store attachments (bytes in-DB, base64)
    for (const a of parsed.attachments ?? []) {
      await db.insert(schema.mailAttachments).values({
        userId,
        messageId: msg.id,
        filename: a.filename ?? "attachment",
        contentType: a.contentType ?? "application/octet-stream",
        sizeBytes: a.size ?? a.content?.length ?? 0,
        contentId: a.contentId ?? null,
        isInline: Boolean(a.contentId) && a.contentDisposition === "inline",
        content: a.content ? Buffer.from(a.content).toString("base64") : null,
      });
    }
    // thread snippet from the freshest body
    if (msg.threadId && bodyText) {
      await db
        .update(schema.mailThreads)
        .set({ snippet: bodyText.replace(/\s+/g, " ").trim().slice(0, 140) })
        .where(eq(schema.mailThreads.id, msg.threadId));
    }
    await client.logout();
  } catch (err) {
    log.warn({ message: messageId, err: (err as Error).message }, "body fetch failed");
    client.close();
  }
}

/* ---------- write-back: mirror UI actions to IMAP ---------- */

export type MailOp =
  | { type: "flag"; messageId: string; flag: "\\Seen" | "\\Flagged"; add: boolean }
  | { type: "move"; messageId: string; targetSpecial: string }
  | { type: "trash"; messageId: string };

export async function applyMailOp(db: Db, log: Logger, userId: string, op: MailOp): Promise<void> {
  const [msg] = await db
    .select()
    .from(schema.mailMessages)
    .where(and(eq(schema.mailMessages.id, op.messageId), eq(schema.mailMessages.userId, userId)))
    .limit(1);
  if (!msg || !msg.uid) return;
  const [folder] = await db
    .select()
    .from(schema.mailFolders)
    .where(eq(schema.mailFolders.id, msg.folderId))
    .limit(1);
  if (!folder) return;
  const ctx = await getMailContext(db, userId);
  if (!ctx) return;

  const targetSpecial = op.type === "trash" ? "trash" : op.type === "move" ? op.targetSpecial : null;
  let targetPath: string | null = null;
  if (targetSpecial) {
    const [tf] = await db
      .select({ path: schema.mailFolders.path })
      .from(schema.mailFolders)
      .where(and(eq(schema.mailFolders.userId, userId), eq(schema.mailFolders.specialUse, targetSpecial)))
      .limit(1);
    targetPath = tf?.path ?? null;
  }

  const client = openImap(ctx.imap);
  try {
    await client.connect();
    await client.mailboxOpen(folder.path, { readOnly: false });
    if (op.type === "flag") {
      if (op.add) await client.messageFlagsAdd(msg.uid, [op.flag], { uid: true });
      else await client.messageFlagsRemove(msg.uid, [op.flag], { uid: true });
    } else if (targetPath) {
      await client.messageMove(msg.uid, targetPath, { uid: true });
    }
    await client.logout();
  } catch (err) {
    log.warn({ op: op.type, err: (err as Error).message }, "mail op failed (will reconcile on next sync)");
    client.close();
  }
}

/**
 * Resurfaces messages whose snooze window has elapsed: clears snoozed_until
 * and marks them unread so they pop back to attention in their folder view.
 * Returns how many were resurfaced.
 */
export async function unsnoozeDue(db: Db): Promise<number> {
  const rows = await db
    .update(schema.mailMessages)
    .set({ snoozedUntil: null, isRead: false })
    .where(and(isNotNull(schema.mailMessages.snoozedUntil), lte(schema.mailMessages.snoozedUntil, new Date())))
    .returning({ id: schema.mailMessages.id });
  return rows.length;
}
