import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@tessportal/db";
import { guardedBody } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Creates or regenerates the private calendar feed token. */
export async function POST(req: Request) {
  const guard = await guardedBody(req, z.object({ regenerate: z.boolean().default(false) }));
  if (!guard.ok) return guard.res;
  const db = getDb();
  const rows = await db
    .select({ icsToken: schema.userSettings.icsToken })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, guard.user.id))
    .limit(1);
  let token = rows[0]?.icsToken ?? null;
  if (!token || guard.body.regenerate) {
    token = randomBytes(24).toString("hex");
    await db
      .insert(schema.userSettings)
      .values({ userId: guard.user.id, icsToken: token })
      .onConflictDoUpdate({
        target: schema.userSettings.userId,
        set: { icsToken: token, updatedAt: new Date() },
      });
  }
  return NextResponse.json({
    ok: true,
    url: `${process.env.APP_URL ?? ""}/api/calendar/ics/${token}`,
  });
}
