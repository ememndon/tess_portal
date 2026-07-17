import { DateTime } from "luxon";
import { Redis } from "ioredis";
import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { getPlatformSmtp } from "./mail";

const { reminders, calendarEvents, users, userSettings, notifications } = schema;

/**
 * Email reminder dispatch: finds due, unsent reminders, emails the
 * event owner at their chosen lead time in their timezone, and drops a
 * live in-app notification. Runs as the reminders.dispatch task on the
 * BullMQ scheduler.
 */
export async function dispatchDueReminders(db: Db, redis: Redis, log: Logger): Promise<string> {
  const due = await db
    .select({
      reminder: reminders,
      event: calendarEvents,
      email: users.email,
      timezone: userSettings.timezone,
    })
    .from(reminders)
    .innerJoin(calendarEvents, eq(calendarEvents.id, reminders.eventId))
    .innerJoin(users, eq(users.id, reminders.userId))
    .leftJoin(userSettings, eq(userSettings.userId, reminders.userId))
    .where(
      and(
        isNull(reminders.sentAt),
        lte(
          sql`${calendarEvents.startsAt} - make_interval(mins => ${reminders.leadMinutes})`,
          sql`now()`,
        ),
        gt(calendarEvents.startsAt, sql`now() - interval '1 hour'`),
      ),
    )
    .limit(50);

  if (due.length === 0) return "no reminders due";

  const smtp = await getPlatformSmtp(db);
  let sent = 0;
  for (const row of due) {
    const zone = row.timezone ?? "UTC";
    const when = DateTime.fromJSDate(row.event.startsAt, { zone }).toFormat("cccc d LLLL, HH:mm");
    if (smtp) {
      try {
        await smtp.transport.sendMail({
          from: smtp.from,
          to: row.email,
          subject: `Reminder: ${row.event.title}`,
          text: [
            row.event.title,
            `${when} (${zone})`,
            row.event.location ? `Where: ${row.event.location}` : "",
            row.event.notes ? `\n${row.event.notes}` : "",
            "",
            "Tess Portal",
          ]
            .filter(Boolean)
            .join("\n"),
        });
      } catch (err) {
        log.error({ err: (err as Error).message }, "reminder email failed");
      }
    }
    const [n] = await db
      .insert(notifications)
      .values({
        userId: row.reminder.userId,
        type: "reminder",
        title: `Reminder: ${row.event.title}`,
        body: `${when} (${zone})`,
        href: "/calendar",
      })
      .returning();
    const [{ unread }] = await db
      .select({ unread: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, row.reminder.userId), isNull(notifications.readAt)));
    await redis
      .publish(
        `notify:${row.reminder.userId}`,
        JSON.stringify({ unread: Number(unread), notification: { id: n.id, title: n.title, type: n.type } }),
      )
      .catch(() => {});
    await db.update(reminders).set({ sentAt: new Date() }).where(eq(reminders.id, row.reminder.id));
    sent += 1;
  }
  return `sent ${sent} reminder${sent === 1 ? "" : "s"}${smtp ? "" : ", email skipped (smtp not configured)"}`;
}
