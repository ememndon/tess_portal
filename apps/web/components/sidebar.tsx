"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  FileText,
  Inbox,
  Kanban,
  ListChecks,
  Mail,
  MessageCircle,
  PhoneCall,
  ScrollText,
  Server,
  Settings,
  Shield,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "@/components/shell-context";

const groups: {
  label: string;
  items: { href: string; label: string; icon: React.ComponentType<{ size?: number | string; className?: string }> }[];
}[] = [
  {
    label: "Work",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/discover", label: "Discover", icon: Sparkles },
      { href: "/documents", label: "Documents", icon: FileText },
      { href: "/mailbox", label: "Mailbox", icon: Inbox },
      { href: "/outreach", label: "Outreach", icon: Mail },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/interviews", label: "Interviews & Offers", icon: PhoneCall },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Tess",
    items: [
      { href: "/chat", label: "Chat", icon: MessageCircle },
      { href: "/playbooks", label: "Playbooks", icon: ListChecks },
      { href: "/jobs-monitor", label: "Jobs Monitor", icon: Activity },
      { href: "/audit-log", label: "Audit Log", icon: ScrollText },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/admin", label: "Admin", icon: Shield },
      { href: "/operations", label: "Operations", icon: Server },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { toggleRight, rightOpen } = useShell();

  const itemClass = (active: boolean) =>
    cn(
      "relative mb-px flex w-full items-center gap-[9px] rounded-[9px] px-[10px] py-[6.5px] text-left text-[12.5px] font-medium",
      active
        ? "bg-jade-dim text-jade before:absolute before:-left-[10px] before:bottom-[20%] before:top-[20%] before:w-[3px] before:rounded-[3px] before:bg-jade before:content-['']"
        : "text-muted hover:bg-raised hover:text-fg",
    );

  return (
    <nav
      aria-label="Sections"
      className="h-full w-full overflow-y-auto bg-surface px-[10px] py-[14px]"
    >
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-[10px] pb-1.5 pt-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
            {group.label}
          </div>
          {group.items.map((item) => {
            const Icon = item.icon;
            // Tess chat lives in the right rail now — this item toggles it.
            if (item.href === "/chat") {
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={toggleRight}
                  aria-pressed={rightOpen}
                  className={itemClass(rightOpen)}
                >
                  <Icon size={15} className="opacity-85" />
                  {item.label}
                </button>
              );
            }
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={itemClass(active)}
              >
                <Icon size={15} className="opacity-85" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
