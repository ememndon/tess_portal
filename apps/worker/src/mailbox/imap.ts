import { ImapFlow } from "imapflow";
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import { decryptSecret, type Logger } from "@tessportal/shared";

/**
 * Mailbox transport resolution + IMAP helpers. The connected account's
 * credentials live in the vault (user_imap / user_smtp) — the same
 * entries the outreach system uses, so one connection powers both. The
 * mail server is the source of truth; the DB is a cache.
 */

export type MailboxConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from?: string;
};

export type MailContext = {
  account: typeof schema.mailAccounts.$inferSelect;
  imap: MailboxConfig;
  smtp: MailboxConfig;
};

function parseVaultConfig(raw: string, defaultSecurePort: number): MailboxConfig | null {
  try {
    const cfg = JSON.parse(raw) as {
      host?: string;
      port?: number | string;
      secure?: boolean | string;
      user?: string;
      pass?: string;
      from?: string;
    };
    if (!cfg.host || !cfg.user || !cfg.pass) return null;
    const port = Number(cfg.port ?? defaultSecurePort);
    return {
      host: cfg.host,
      port,
      secure: cfg.secure === undefined ? port === defaultSecurePort : String(cfg.secure) !== "false",
      user: cfg.user,
      pass: cfg.pass,
      from: cfg.from,
    };
  } catch {
    return null;
  }
}

async function readVault(db: Db, userId: string, kind: string): Promise<string | null> {
  const rows = await db
    .select({ ciphertext: schema.vaultSecrets.ciphertext })
    .from(schema.vaultSecrets)
    .where(
      and(
        eq(schema.vaultSecrets.userId, userId),
        eq(schema.vaultSecrets.kind, kind),
        eq(schema.vaultSecrets.name, "default"),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  const master = process.env.VAULT_MASTER_KEY;
  if (!master) return null;
  try {
    return decryptSecret(master, rows[0].ciphertext);
  } catch {
    return null;
  }
}

/** Resolves a user's connected mailbox: account row + IMAP/SMTP configs. */
export async function getMailContext(db: Db, userId: string): Promise<MailContext | null> {
  const [account] = await db
    .select()
    .from(schema.mailAccounts)
    .where(eq(schema.mailAccounts.userId, userId))
    .limit(1);
  if (!account) return null;
  const imapRaw = await readVault(db, userId, "user_imap");
  const smtpRaw = await readVault(db, userId, "user_smtp");
  if (!imapRaw || !smtpRaw) return null;
  const imap = parseVaultConfig(imapRaw, 993);
  const smtp = parseVaultConfig(smtpRaw, 465);
  if (!imap || !smtp) return null;
  return { account, imap, smtp };
}

export function openImap(cfg: MailboxConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    socketTimeout: 30000,
  });
}

/** Maps IMAP SPECIAL-USE flags (and INBOX) to our special_use vocabulary. */
export function mapSpecialUse(path: string, specialUse?: string): string | null {
  if (path.toUpperCase() === "INBOX") return "inbox";
  switch (specialUse) {
    case "\\Sent":
      return "sent";
    case "\\Drafts":
      return "drafts";
    case "\\Trash":
      return "trash";
    case "\\Junk":
      return "junk";
    case "\\Archive":
      return "archive";
    case "\\All":
      return "all";
    case "\\Flagged":
      return "starred";
    default:
      return null;
  }
}

const SORT: Record<string, number> = {
  inbox: 0,
  starred: 5,
  sent: 10,
  drafts: 20,
  archive: 30,
  junk: 40,
  trash: 50,
  all: 60,
};

/**
 * Discovers the account's folders (IMAP LIST with special-use) and
 * upserts them into mail_folders. Idempotent; safe to run on every
 * connect and periodically.
 */
export async function discoverFolders(db: Db, log: Logger, userId: string): Promise<number> {
  const ctx = await getMailContext(db, userId);
  if (!ctx) return 0;
  const client = openImap(ctx.imap);
  let count = 0;
  try {
    await client.connect();
    const list = await client.list();
    for (const f of list) {
      const special = mapSpecialUse(f.path, f.specialUse);
      await db
        .insert(schema.mailFolders)
        .values({
          userId,
          accountId: ctx.account.id,
          name: f.name,
          path: f.path,
          specialUse: special,
          subscribed: f.subscribed !== false,
          sortOrder: special ? SORT[special] ?? 100 : 100,
        })
        .onConflictDoUpdate({
          target: [schema.mailFolders.accountId, schema.mailFolders.path],
          set: {
            name: f.name,
            specialUse: special,
            subscribed: f.subscribed !== false,
            sortOrder: special ? SORT[special] ?? 100 : 100,
          },
        });
      count += 1;
    }
    await client.logout();
  } catch (err) {
    log.warn({ user: userId, err: (err as Error).message }, "folder discovery failed");
    client.close();
    return 0;
  }
  return count;
}

/** Finds the IMAP path of a special-use folder for this account. */
export async function specialFolderPath(
  db: Db,
  userId: string,
  use: string,
): Promise<string | null> {
  const [row] = await db
    .select({ path: schema.mailFolders.path })
    .from(schema.mailFolders)
    .where(and(eq(schema.mailFolders.userId, userId), eq(schema.mailFolders.specialUse, use)))
    .limit(1);
  return row?.path ?? null;
}
