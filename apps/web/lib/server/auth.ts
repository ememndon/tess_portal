import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { getDb } from "./db";
import { signPayload, verifySigned } from "./signing";

const { users, sessions, gateConfig } = schema;

export const GATE_COOKIE = "tp_gate";
export const SESSION_COOKIE = "tp_session";
const GATE_TTL_S = 30 * 24 * 3600;
const SESSION_TTL_S = 30 * 24 * 3600;

type GatePayload = { v: number; exp: number };
type SessionPayload = { t: string; exp: number };

export type AuthedUser = typeof users.$inferSelect;

/* ---------- passwords ---------- */

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashValue, password);
  } catch {
    return false;
  }
}

/* ---------- gate (layer one) ---------- */

export async function getGate() {
  const db = getDb();
  const rows = await db.select().from(gateConfig).where(eq(gateConfig.id, 1)).limit(1);
  return rows[0] ?? null;
}

export async function verifyGateCredential(username: string, password: string): Promise<boolean> {
  const gate = await getGate();
  if (!gate) return false;
  if (gate.username !== username) {
    // burn the same time as a real check so the username is not probeable
    await verifyPassword(gate.passwordHash, password);
    return false;
  }
  return verifyPassword(gate.passwordHash, password);
}

export async function issueGateCookie(version: number) {
  // Persistent 30-day gate cookie. The "re-prompt on browser reopen" behaviour
  // is handled by the Caddy HTTP Basic Auth outer wall in front of the app, so
  // this app-level gate (layer two of three) stays remembered like the session.
  const exp = Math.floor(Date.now() / 1000) + GATE_TTL_S;
  (await cookies()).set(GATE_COOKIE, signPayload({ v: version, exp } satisfies GatePayload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: GATE_TTL_S,
  });
}

/** Returns true when the request carries a gate cookie at the current version. */
export async function gatePassed(): Promise<boolean> {
  const payload = verifySigned<GatePayload>((await cookies()).get(GATE_COOKIE)?.value);
  if (!payload || payload.exp * 1000 < Date.now()) return false;
  const gate = await getGate();
  if (!gate) return false;
  return payload.v === gate.version;
}

/* ---------- sessions (layer two) ---------- */

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const db = getDb();
  const gate = await getGate();
  const token = randomBytes(32).toString("hex");
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_S * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    gateVersion: gate?.version ?? 0,
    ip: await requestIp(),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    expiresAt,
  });
  const exp = Math.floor(expiresAt.getTime() / 1000);
  (await cookies()).set(SESSION_COOKIE, signPayload({ t: token, exp } satisfies SessionPayload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export async function getSessionUser(): Promise<AuthedUser | null> {
  const payload = verifySigned<SessionPayload>((await cookies()).get(SESSION_COOKIE)?.value);
  if (!payload || payload.exp * 1000 < Date.now()) return null;
  const db = getDb();
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(payload.t)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function revokeCurrentSession() {
  const payload = verifySigned<SessionPayload>((await cookies()).get(SESSION_COOKIE)?.value);
  if (payload) {
    await getDb()
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, hashToken(payload.t)));
  }
  (await cookies()).delete(SESSION_COOKIE);
}

/** Revokes every session of the user except the one on this request. */
export async function revokeOtherSessions(userId: string) {
  const payload = verifySigned<SessionPayload>((await cookies()).get(SESSION_COOKIE)?.value);
  const current = payload ? hashToken(payload.t) : "";
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, current)));
}

/* ---------- guards ---------- */

/** Page guard: redirects through the two layers in order. */
export async function requireUser(): Promise<AuthedUser> {
  if (!(await gatePassed())) redirect("/gate");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Page guard that also requires completed onboarding. */
export async function requireOnboardedUser(): Promise<AuthedUser> {
  const user = await requireUser();
  if (!user.onboardedAt) redirect("/onboarding");
  return user;
}

/** API guard: returns null instead of redirecting. */
export async function apiUser(): Promise<AuthedUser | null> {
  if (!(await gatePassed())) return null;
  return getSessionUser();
}

/* ---------- request helpers ---------- */

export async function requestIp(): Promise<string> {
  const h = await headers();
  // Behind a single trusted reverse proxy (Caddy), the real client IP is
  // the LAST value it appends to X-Forwarded-For. Client-supplied entries
  // are prepended to the left, so trusting the leftmost value would let an
  // attacker spoof their IP and evade per-IP rate limiting.
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return h.get("x-real-ip") ?? "unknown";
}

/** CSRF guard for mutating API routes: the Origin must be our own app. */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return true; // non-browser client with a valid session cookie
  const app = process.env.APP_URL ?? "";
  return origin === app || origin === `http://${h.get("host")}` || origin === `https://${h.get("host")}`;
}
