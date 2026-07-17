import nodemailer from "nodemailer";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import { decryptSecret } from "@tessportal/shared";

const { vaultSecrets } = schema;

/** Platform SMTP from the vault, shared by worker tasks. */
export async function getPlatformSmtp(db: Db) {
  const rows = await db
    .select({ ciphertext: vaultSecrets.ciphertext })
    .from(vaultSecrets)
    .where(
      and(
        isNull(vaultSecrets.userId),
        eq(vaultSecrets.kind, "platform_smtp"),
        eq(vaultSecrets.name, "default"),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  const masterKey = process.env.VAULT_MASTER_KEY;
  if (!masterKey) return null;
  try {
    const cfg = JSON.parse(decryptSecret(masterKey, rows[0].ciphertext)) as {
      host: string;
      port: number | string;
      secure?: boolean | string;
      user: string;
      pass: string;
      from?: string;
    };
    return {
      transport: nodemailer.createTransport({
        host: cfg.host,
        port: Number(cfg.port),
        secure: cfg.secure === undefined ? true : String(cfg.secure) !== "false",
        auth: { user: cfg.user, pass: cfg.pass },
      }),
      from: cfg.from || "Tess Portal <tess@tessconsole.cloud>",
    };
  } catch {
    return null;
  }
}
