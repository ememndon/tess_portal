import { NextResponse } from "next/server";
import { guardedBody } from "@/lib/server/api";
import { requestIp } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { scopeFor } from "@/lib/server/dal";
import { embedText } from "@/lib/ai/run";
import { profileSchema } from "@/lib/cv/schema";
import { profileToText } from "@/lib/match/score";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The mandatory confirm step. The user's reviewed profile is validated
 * against the strict schema, embedded for match scoring, and stored as
 * confirmed. Only a confirmed profile is trusted downstream.
 */
export async function POST(req: Request) {
  const guard = await guardedBody(req, profileSchema);
  if (!guard.ok) return guard.res;
  const profile = guard.body;
  const scope = scopeFor(guard.user.id);

  const embedding = await embedText(guard.user.id, profileToText(profile)).catch(() => null);
  await scope.confirmProfile(profile, embedding);

  await audit({
    userId: guard.user.id,
    action: "profile.confirmed",
    targetType: "profile",
    snapshot: { skills: profile.skills.length, experience: profile.experience.length },
    ip: await requestIp(),
  });

  return NextResponse.json({ ok: true });
}
