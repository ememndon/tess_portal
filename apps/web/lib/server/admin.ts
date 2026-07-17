import { createHash, randomBytes } from "node:crypto";
import { desc, eq, isNull } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { getDb } from "./db";
import { hashPassword } from "./auth";

const { users, invites, gateConfig, auditLog } = schema;

/**
 * Admin, system scope only. Everyone is an admin for these functions.
 * Nothing here may ever return another user's personal data: user
 * listings carry account facts only, the system log carries only
 * entries flagged system.
 */

export async function listUsers() {
  return getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      onboardedAt: users.onboardedAt,
    })
    .from(users)
    .orderBy(users.createdAt);
}

export async function listPendingInvites() {
  return getDb()
    .select({
      id: invites.id,
      email: invites.email,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      inviterEmail: users.email,
    })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.invitedBy))
    .where(isNull(invites.acceptedAt))
    .orderBy(desc(invites.createdAt));
}

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * Creates (or refreshes) an invite and returns the one-time link. The
 * raw token is never stored, only its hash, so the link is shown once.
 */
export async function createInvite(email: string, invitedBy: string | null) {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const normalized = email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  // one pending invite per address: replace any prior unaccepted one
  await db.delete(invites).where(eq(invites.email, normalized));
  await db.insert(invites).values({ email: normalized, tokenHash, invitedBy, expiresAt });

  const link = `${process.env.APP_URL ?? ""}/invite/${token}`;
  return { link, email: normalized, expiresAt };
}

export async function findInviteByToken(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await getDb().select().from(invites).where(eq(invites.tokenHash, tokenHash)).limit(1);
  const invite = rows[0];
  if (!invite) return null;
  if (invite.acceptedAt || invite.expiresAt < new Date()) return null;
  return invite;
}

export async function rotateGate(username: string, password: string) {
  const db = getDb();
  const passwordHash = await hashPassword(password);
  const existing = await db.select().from(gateConfig).where(eq(gateConfig.id, 1)).limit(1);
  if (existing[0]) {
    const [row] = await db
      .update(gateConfig)
      .set({ username, passwordHash, version: existing[0].version + 1, updatedAt: new Date() })
      .where(eq(gateConfig.id, 1))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(gateConfig)
    .values({ id: 1, username, passwordHash, version: 1 })
    .returning();
  return row;
}

export async function listSystemLog(limit = 100) {
  return getDb()
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      createdAt: auditLog.createdAt,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.system, true))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
