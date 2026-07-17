import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { generatePrepPack } from "@/lib/intel/prep";
import { createNotification } from "@/lib/server/notify";
import { getLogger } from "@/lib/server/health";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  jobId: z.string().uuid(),
  round: z.string().trim().min(1).max(120),
  medium: z.enum(["video", "phone", "onsite"]),
  locationOrLink: z.string().trim().max(2000).optional(),
  /** naive local datetime, interpreted in the user's timezone */
  localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  durationMin: z.coerce.number().int().min(15).max(480),
  reminderLeadMinutes: z.array(z.coerce.number().int().min(5).max(20160)).max(6).default([]),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, createSchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const settings = await scope.getSettings();
  const scheduledAt = DateTime.fromISO(guard.body.localDateTime, {
    zone: settings.timezone,
  });
  if (!scheduledAt.isValid) return jsonError("that date and time do not parse", 400);

  const interview = await scope.createInterview({
    jobId: guard.body.jobId,
    round: guard.body.round,
    medium: guard.body.medium,
    locationOrLink: guard.body.locationOrLink,
    scheduledAt: scheduledAt.toJSDate(),
    durationMin: guard.body.durationMin,
    reminderLeadMinutes: guard.body.reminderLeadMinutes,
  });
  if (!interview) return jsonError("job not found", 404);

  // a prep pack is generated the moment the interview lands, without
  // being asked. Fire-and-forget so scheduling stays instant.
  void generatePrepPack(guard.user.id, interview.id)
    .then((pack) => {
      if (pack) {
        return createNotification(guard.user.id, {
          type: "prep.ready",
          title: "Interview prep pack ready",
          body: `${pack.likelyQuestions.length} likely questions, mapped to your stories.`,
          href: "/interviews",
        });
      }
    })
    .catch((err) => getLogger().error({ err: (err as Error).message }, "prep pack generation failed"));

  return NextResponse.json({ ok: true, id: interview.id });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  outcome: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/).optional(),
  durationMin: z.coerce.number().int().min(15).max(480).optional(),
});

export async function PATCH(req: Request) {
  const guard = await guardedBody(req, patchSchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const { id, localDateTime, ...rest } = guard.body;
  let scheduledAt: Date | undefined;
  if (localDateTime) {
    const settings = await scope.getSettings();
    const dt = DateTime.fromISO(localDateTime, { zone: settings.timezone });
    if (!dt.isValid) return jsonError("that date and time do not parse", 400);
    scheduledAt = dt.toJSDate();
  }
  const interview = await scope.updateInterview(id, { ...rest, scheduledAt });
  return interview ? NextResponse.json({ ok: true }) : jsonError("interview not found", 404);
}

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, z.object({ id: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  const ok = await scopeFor(guard.user.id).deleteInterview(guard.body.id);
  return ok ? NextResponse.json({ ok: true }) : jsonError("interview not found", 404);
}
