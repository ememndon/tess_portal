import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { CalendarClient, EventQuickAdd, IcsCard } from "./calendar-client";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const user = await requireOnboardedUser();
  const settings = await scopeFor(user.id).getSettings();

  return (
    <div className="flex flex-col gap-gap">
      <div className="flex items-center">
        <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
          Calendar
        </h1>
        <span className="ml-3 font-mono text-[10.5px] text-faint">{settings.timezone}</span>
      </div>
      <div className="grid grid-cols-1 gap-gap lg:grid-cols-[1fr_300px]">
        <div className="rounded-card border border-line bg-surface p-cardpad">
          <CalendarClient timezone={settings.timezone} />
        </div>
        <div className="flex flex-col gap-gap">
          <div className="rounded-card border border-line bg-surface">
            <div className="flex items-center p-cardpad pb-2.5">
              <h2 className="font-disp text-[13.5px] font-bold">Add an event</h2>
            </div>
            <div className="border-t border-line p-cardpad">
              <EventQuickAdd />
            </div>
          </div>
          <IcsCard />
        </div>
      </div>
    </div>
  );
}
