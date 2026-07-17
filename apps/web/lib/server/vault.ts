import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { decryptSecret, encryptSecret } from "@tessportal/shared";
import { getDb } from "./db";

const { vaultSecrets } = schema;

/**
 * Secret Vault service. Write-only at every boundary: setSecret and
 * deleteSecret are exposed to the UI through the API, listSecretMeta
 * returns names and timestamps only. readSecret exists for internal
 * services (mailer, scrapers, providers) and its output must never be
 * serialized into a response, log, or error message.
 */

export const PLATFORM_KINDS = ["platform_api_key", "platform_smtp", "proxy"] as const;
export const USER_KINDS = ["user_smtp", "user_imap"] as const;

function masterKey(): string {
  const k = process.env.VAULT_MASTER_KEY;
  if (!k) throw new Error("VAULT_MASTER_KEY is not set");
  return k;
}

function scopeWhere(userId: string | null, kind: string, name: string) {
  return and(
    userId === null ? isNull(vaultSecrets.userId) : eq(vaultSecrets.userId, userId),
    eq(vaultSecrets.kind, kind),
    eq(vaultSecrets.name, name),
  );
}

export async function setSecret(
  userId: string | null,
  kind: string,
  name: string,
  value: string,
) {
  const ciphertext = encryptSecret(masterKey(), value);
  await getDb()
    .insert(vaultSecrets)
    .values({ userId, kind, name, ciphertext })
    .onConflictDoUpdate({
      target: [vaultSecrets.userId, vaultSecrets.kind, vaultSecrets.name],
      set: { ciphertext, updatedAt: new Date() },
    });
}

export async function deleteSecret(userId: string | null, kind: string, name: string) {
  await getDb().delete(vaultSecrets).where(scopeWhere(userId, kind, name));
}

/** Metadata only. Never includes ciphertext or plaintext. */
export async function listSecretMeta(userId: string | null) {
  const db = getDb();
  const rows = await db
    .select({
      kind: vaultSecrets.kind,
      name: vaultSecrets.name,
      updatedAt: vaultSecrets.updatedAt,
    })
    .from(vaultSecrets)
    .where(userId === null ? isNull(vaultSecrets.userId) : eq(vaultSecrets.userId, userId));
  return rows;
}

/** Internal read for services. Never expose the return value outward. */
export async function readSecret(
  userId: string | null,
  kind: string,
  name: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({ ciphertext: vaultSecrets.ciphertext })
    .from(vaultSecrets)
    .where(scopeWhere(userId, kind, name))
    .limit(1);
  if (!rows[0]) return null;
  return decryptSecret(masterKey(), rows[0].ciphertext);
}
