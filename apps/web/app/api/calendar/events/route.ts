import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { z } from "zod";
import { apiUser } from "@/lib/server/auth";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  const url = new URL(req.url);
  const start = new Date(url.searchParams.get("start") ?? "");
  const end = new Date(url.searchParams.get("end") ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return jsonError("start and end are required", 400);
  }
  const events = await scopeFor(user.id).listCalendarEvents(start, end);
  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      start: e.startsAt.toISOString(),
      end: e.endsAt?.toISOString() ?? null,
      allDay: e.allDay,
      extendedProps: { kind: e.kind, location: e.location, notes: e.notes },
    })),
  });
}

const createSchema = z.object({
  title: z.string().trim().min(1, "give the event a title").max(200),
  localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  durationMin: z.coerce.number().int().min(0).max(1440).default(60),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(500).optional(),
  notes: z.string().max(5000).optional(),
  reminderLeadMinutes: z.array(z.coerce.number().int().min(5).max(20160)).max(6).default([]),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, createSchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const settings = await scope.getSettings();
  const start = DateTime.fromISO(guard.body.localDateTime, { zone: settings.timezone });
  if (!start.isValid) return jsonError("that date and time do not parse", 400);
  const event = await scope.createCustomEvent({
    title: guard.body.title,
    startsAt: start.toJSDate(),
    endsAt: guard.body.allDay
      ? undefined
      : start.plus({ minutes: guard.body.durationMin }).toJSDate(),
    allDay: guard.body.allDay,
    location: guard.body.location,
    notes: guard.body.notes,
    reminderLeadMinutes: guard.body.reminderLeadMinutes,
  });
  return NextResponse.json({ ok: true, id: event.id });
}

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, z.object({ id: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  const ok = await scopeFor(guard.user.id).deleteCustomEvent(guard.body.id);
  return ok
    ? NextResponse.json({ ok: true })
    : jsonError("only custom events delete here, interviews and offers manage their own", 404);
}
