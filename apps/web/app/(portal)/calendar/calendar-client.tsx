"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import luxonPlugin from "@fullcalendar/luxon3";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const KIND_COLORS: Record<string, string> = {
  interview: "var(--jade)",
  deadline: "var(--gold)",
  reminder: "var(--blue)",
  custom: "var(--violet)",
};

export function CalendarClient({ timezone }: { timezone: string }) {
  return (
    <div className="tp-calendar">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, luxonPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek" }}
        timeZone={timezone}
        height="auto"
        events={async (info, success, failure) => {
          try {
            const res = await fetch(
              `/api/calendar/events?start=${encodeURIComponent(info.startStr)}&end=${encodeURIComponent(info.endStr)}`,
            );
            if (!res.ok) throw new Error("failed");
            const data = (await res.json()) as { events: { extendedProps: { kind: string } }[] };
            success(
              data.events.map((e) => ({
                ...e,
                color: "transparent",
                borderColor:
                  KIND_COLORS[(e.extendedProps?.kind as string) ?? "custom"] ?? "var(--violet)",
                textColor: "var(--text)",
              })),
            );
          } catch (err) {
            failure(err as Error);
          }
        }}
        firstDay={1}
        dayMaxEventRows={3}
        nowIndicator
      />
    </div>
  );
}

export function EventQuickAdd() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.title,
        localDateTime: data.localDateTime,
        durationMin: Number(data.durationMin || 60),
        location: data.location || undefined,
        reminderLeadMinutes: data.remind ? [Number(data.remind)] : [],
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not add the event");
      return;
    }
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <div>
        <Label htmlFor="ev-title">Title</Label>
        <Input id="ev-title" name="title" required />
      </div>
      <div>
        <Label htmlFor="ev-when">When, your timezone</Label>
        <Input id="ev-when" name="localDateTime" type="datetime-local" required />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <Label htmlFor="ev-duration">Minutes</Label>
          <Input id="ev-duration" name="durationMin" type="number" defaultValue={60} min={0} />
        </div>
        <div>
          <Label htmlFor="ev-remind">Email reminder</Label>
          <select
            id="ev-remind"
            name="remind"
            defaultValue="60"
            className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
          >
            <option value="">None</option>
            <option value="1440">1 day before</option>
            <option value="120">2 hours before</option>
            <option value="60">1 hour before</option>
            <option value="30">30 minutes before</option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="ev-loc">Location</Label>
        <Input id="ev-loc" name="location" />
      </div>
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Adding" : "Add event"}
        </Button>
      </div>
    </form>
  );
}

export function IcsCard() {
  const [url, setUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function generate(regenerate: boolean) {
    setBusy(true);
    const res = await fetch("/api/calendar/ics-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regenerate }),
    });
    setBusy(false);
    if (res.ok) {
      const payload = (await res.json()) as { url: string };
      setUrl(payload.url);
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-center p-cardpad pb-2.5">
        <h2 className="font-disp text-[13.5px] font-bold">Phone subscription</h2>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-line p-cardpad">
        <p className="text-[11.5px] text-muted">
          A private read-only feed for your phone or any calendar app. Anyone with the link can
          read your events, so treat it like a password. Regenerating kills the old link.
        </p>
        {url ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[7px] border border-line bg-bg px-2.5 py-1.5 font-mono text-[10px] text-fg">
              {url}
            </code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(url)}>
              Copy
            </Button>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => generate(false)} disabled={busy}>
            Show my feed link
          </Button>
          <Button variant="ghost" onClick={() => generate(true)} disabled={busy}>
            Regenerate
          </Button>
        </div>
      </div>
    </div>
  );
}
