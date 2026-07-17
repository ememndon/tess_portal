import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import { decryptSecret } from "@tessportal/shared";

/**
 * Resolves the rotating proxy URL from the vault. Used only by sources
 * that toggled the proxy on. Returns null when no proxy is configured.
 */
export async function resolveProxyUrl(db: Db): Promise<string | null> {
  const rows = await db
    .select({ ciphertext: schema.vaultSecrets.ciphertext })
    .from(schema.vaultSecrets)
    .where(
      and(
        isNull(schema.vaultSecrets.userId),
        eq(schema.vaultSecrets.kind, "proxy"),
        eq(schema.vaultSecrets.name, "default"),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  const master = process.env.VAULT_MASTER_KEY;
  if (!master) return null;
  try {
    const cfg = JSON.parse(decryptSecret(master, rows[0].ciphertext)) as { url: string; user?: string; pass?: string };
    if (!cfg.url) return null;
    const u = new URL(cfg.url);
    if (cfg.user) u.username = cfg.user;
    if (cfg.pass) u.password = cfg.pass;
    return u.toString();
  } catch {
    return null;
  }
}
