import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { requestIp, revokeCurrentSession, verifyPassword } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ password: z.string().min(1).max(500) });

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const { user } = guard;

  if (!(await verifyPassword(user.passwordHash, guard.body.password))) {
    return NextResponse.json({ error: "your password is not right" }, { status: 401 });
  }

  await revokeCurrentSession();
  await scopeFor(user.id).deleteAccount();

  // system record with no actor link, so it survives the cascade and
  // holds no personal data beyond the fact of deletion
  await audit({
    userId: null,
    action: "account.deleted",
    targetType: "user",
    targetId: user.id,
    ip: await requestIp(),
    system: true,
  });

  return NextResponse.json({ ok: true });
}
