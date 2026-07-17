import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secret Vault crypto. AES-256-GCM via node:crypto, master key from the
 * environment only, unique IV per record. The stored blob is
 * base64(iv | authTag | ciphertext). Nothing in this module logs, and
 * plaintext never leaves the call stack of the function that needed it.
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function keyFromHex(masterKeyHex: string): Buffer {
  const key = Buffer.from(masterKeyHex, "hex");
  if (key.length !== 32) {
    throw new Error("vault master key must be 32 bytes of hex");
  }
  return key;
}

export function encryptSecret(masterKeyHex: string, plaintext: string): string {
  const key = keyFromHex(masterKeyHex);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(masterKeyHex: string, blob: string): string {
  const key = keyFromHex(masterKeyHex);
  const raw = Buffer.from(blob, "base64");
  if (raw.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("vault blob is malformed");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const data = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Re-encrypts a blob under a new master key, for key rotation. */
export function reencryptSecret(
  oldMasterKeyHex: string,
  newMasterKeyHex: string,
  blob: string,
): string {
  return encryptSecret(newMasterKeyHex, decryptSecret(oldMasterKeyHex, blob));
}

/** Constant-time string comparison for tokens and credentials. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
