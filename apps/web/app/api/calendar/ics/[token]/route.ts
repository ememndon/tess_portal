import ical from "ical-generator";
import { eq } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { getDb } from "@/lib/server/db";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

/**
 * Private read-only ICS feed. The token is the only credential, it is
 * unguessable, regenerable, and maps to exactly one user. Times are
 * emitted in UTC; subscribing calendars localize them.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return new Response("not found", { status: 404 });
  const db = getDb();
  const rows = await db
    .select({ userId: schema.userSettings.userId, timezone: schema.userSettings.timezone })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.icsToken, token))
    .limit(1);
  const owner = rows[0];
  if (!owner) return new Response("not found", { status: 404 });

  const events = await scopeFor(owner.userId).listAllCalendarEvents();
  const cal = ical({ name: "Tess Portal", prodId: "//tessportal//calendar//EN" });
  for (const e of events) {
    cal.createEvent({
      id: e.id,
      start: e.startsAt,
      end: e.endsAt ?? undefined,
      allDay: e.allDay,
      summary: e.title,
      description: e.notes ?? undefined,
      location: e.location ?? undefined,
    });
  }
  return new Response(cal.toString(), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}
