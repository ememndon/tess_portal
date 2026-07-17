import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema as dbSchema } from "@tessportal/db";
import { createSession, gatePassed, hashPassword, requestIp, sameOrigin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { findInviteByToken } from "@/lib/server/admin";
import { allowAttempt } from "@/lib/server/rate-limit";
import { audit } from "@/lib/server/audit";
import { createNotification } from "@/lib/server/notify";
import { jsonError } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(32).max(200),
  name: z.string().trim().min(1, "enter your name").max(200),
  password: z.string().min(10, "use at least 10 characters").max(500),
});

export async function POST(req: Request) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  if (!(await gatePassed())) return jsonError("gate required", 401);
  if (!(await allowAttempt(await requestIp()))) {
    return jsonError("too many attempts, wait 15 minutes", 429);
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "invalid input", 400);

  const invite = await findInviteByToken(parsed.data.token);
  if (!invite) return jsonError("this invite link is no longer valid, ask for a new one", 410);

  const db = getDb();
  const existing = await db
    .select({ id: dbSchema.users.id })
    .from(dbSchema.users)
    .where(eq(dbSchema.users.email, invite.email))
    .limit(1);
  if (existing[0]) return jsonError("an account with this email already exists, sign in instead", 409);

  const passwordHash = await hashPassword(parsed.data.password);
  const [user] = await db
    .insert(dbSchema.users)
    .values({ email: invite.email, name: parsed.data.name, passwordHash })
    .returning();
  await db.insert(dbSchema.userSettings).values({ userId: user.id });
  await db
    .update(dbSchema.invites)
    .set({ acceptedAt: new Date() })
    .where(eq(dbSchema.invites.id, invite.id));

  await audit({
    userId: user.id,
    action: "invite.accepted",
    targetType: "invite",
    targetId: invite.id,
    snapshot: { email: invite.email },
    ip: await requestIp(),
    system: true,
  });
  if (invite.invitedBy) {
    await createNotification(invite.invitedBy, {
      type: "user.joined",
      title: `${parsed.data.name} accepted your invite`,
      body: `${invite.email} just joined Tess Portal.`,
      href: "/admin",
    }).catch(() => {});
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
