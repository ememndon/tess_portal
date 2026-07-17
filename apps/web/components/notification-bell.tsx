"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

/**
 * Bell with live unread count over SSE. The jade dot is the only
 * accent, per the design system.
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = React.useState(initialUnread);

  React.useEffect(() => {
    const source = new EventSource("/api/notifications/stream");
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { unread?: number };
        if (typeof data.unread === "number") setUnread(data.unread);
      } catch {
        // ignore malformed frames
      }
    };
    return () => source.close();
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-line bg-bg text-muted hover:bg-raised hover:text-fg"
    >
      <Bell size={14} />
      {unread > 0 ? (
        <span className="absolute -right-[3px] -top-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-pill bg-jade-fill px-[3px] font-mono text-[9px] font-bold text-jade-ink">
          {unread > 99 ? "99" : unread}
        </span>
      ) : null}
    </Link>
  );
}
