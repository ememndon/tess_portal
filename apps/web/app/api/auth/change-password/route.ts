import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema as dbSchema } from "@tessportal/db";
import {
  hashPassword,
  requestIp,
  revokeOtherSessions,
  verifyPassword,
} from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { allowAttempt, clearAccount } from "@/lib/server/rate-limit";
import { guardedBody } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  current: z.string().min(1).max(500),
  next: z.string().min(10, "use at least 10 characters").max(500),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const { user, body } = guard;

  // throttle current-password guessing, mirroring the login endpoint
  if (!(await allowAttempt(await requestIp(), user.email))) {
    return NextResponse.json(
      { error: "too many attempts, please wait a few minutes and try again" },
      { status: 429 },
    );
  }
  if (!(await verifyPassword(user.passwordHash, body.current))) {
    return NextResponse.json({ error: "your current password is not right" }, { status: 401 });
  }
  await clearAccount(user.email);

  await getDb()
    .update(dbSchema.users)
    .set({ passwordHash: await hashPassword(body.next), updatedAt: new Date() })
    .where(eq(dbSchema.users.id, user.id));

  // security rule: password change revokes every other session
  await revokeOtherSessions(user.id);
  await audit({
    userId: user.id,
    action: "account.password_changed",
    ip: await requestIp(),
  });
  return NextResponse.json({ ok: true });
}
