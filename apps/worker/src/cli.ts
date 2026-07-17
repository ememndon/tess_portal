import { createHash, randomBytes } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@tessportal/db";
import { reencryptSecret } from "@tessportal/shared";

/**
 * Operator CLI, run inside the worker container:
 *   docker compose exec worker ./node_modules/.bin/tsx apps/worker/src/cli.ts <command>
 *
 * Commands:
 *   set-gate <username> <password>   set or rotate the universal gate credential
 *   create-invite <email>            create an invite and print its one-time link
 *   rotate-vault-key                 re-encrypt the vault under VAULT_MASTER_KEY_NEW
 */

const { gateConfig, invites, vaultSecrets } = schema;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { db, client } = createDb(process.env.DATABASE_URL ?? "", { max: 2 });

  try {
    if (command === "set-gate") {
      const [username, password] = args;
      if (!username || !password || password.length < 10) {
        console.error("usage: set-gate <username> <password with 10+ characters>");
        process.exit(1);
      }
      const passwordHash = await argonHash(password, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const existing = await db.select().from(gateConfig).where(eq(gateConfig.id, 1)).limit(1);
      if (existing[0]) {
        await db
          .update(gateConfig)
          .set({ username, passwordHash, version: existing[0].version + 1, updatedAt: new Date() })
          .where(eq(gateConfig.id, 1));
        console.log(`gate credential rotated, version ${existing[0].version + 1}`);
      } else {
        await db.insert(gateConfig).values({ id: 1, username, passwordHash, version: 1 });
        console.log("gate credential set, version 1");
      }
      return;
    }

    if (command === "create-invite") {
      const [email] = args;
      if (!email || !email.includes("@")) {
        console.error("usage: create-invite <email>");
        process.exit(1);
      }
      const normalized = email.trim().toLowerCase();
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await db.delete(invites).where(eq(invites.email, normalized));
      await db.insert(invites).values({
        email: normalized,
        tokenHash,
        invitedBy: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      });
      console.log(`invite created for ${normalized}, expires in 7 days:`);
      console.log(`${process.env.APP_URL ?? ""}/invite/${token}`);
      return;
    }

    if (command === "rotate-vault-key") {
      const oldKey = process.env.VAULT_MASTER_KEY;
      const newKey = process.env.VAULT_MASTER_KEY_NEW;
      if (!oldKey || !newKey) {
        console.error("set VAULT_MASTER_KEY (current) and VAULT_MASTER_KEY_NEW, then rerun");
        process.exit(1);
      }
      const rows = await db.select().from(vaultSecrets);
      for (const row of rows) {
        await db
          .update(vaultSecrets)
          .set({
            ciphertext: reencryptSecret(oldKey, newKey, row.ciphertext),
            keyVersion: row.keyVersion + 1,
            updatedAt: new Date(),
          })
          .where(eq(vaultSecrets.id, row.id));
      }
      console.log(`${rows.length} vault records re-encrypted.`);
      console.log("Now set VAULT_MASTER_KEY to the new key in .env and restart the stack.");
      return;
    }

    console.error("commands: set-gate, create-invite, rotate-vault-key");
    process.exit(1);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
