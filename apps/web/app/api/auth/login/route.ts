import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema as dbSchema } from "@tessportal/db";
import {
  createSession,
  gatePassed,
  requestIp,
  sameOrigin,
  verifyPassword,
} from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { allowAttempt, clearAccount } from "@/lib/server/rate-limit";
import { jsonError } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(500),
});

export async function POST(req: Request) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  if (!(await gatePassed())) return jsonError("gate required", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("enter your email and password", 400);
  const email = parsed.data.email.trim().toLowerCase();

  if (!(await allowAttempt(await requestIp(), email))) {
    return jsonError("too many attempts, wait 15 minutes", 429);
  }

  const rows = await getDb()
    .select()
    .from(dbSchema.users)
    .where(eq(dbSchema.users.email, email))
    .limit(1);
  const user = rows[0];
  const ok = user ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
  if (!user || !ok) return jsonError("that email or password is not right", 401);

  await createSession(user.id);
  await clearAccount(email);
  return NextResponse.json({ ok: true, onboarded: Boolean(user.onboardedAt) });
}
