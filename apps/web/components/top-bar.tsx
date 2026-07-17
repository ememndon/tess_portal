import Link from "next/link";
import { Logo } from "@/components/logo";
import { NotificationBell } from "@/components/notification-bell";
import { SearchCommand } from "@/components/search-command";
import { LeftToggle, RightToggle } from "@/components/shell-toggles";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

export function TopBar({
  userName,
  userEmail,
  initialUnread,
}: {
  userName: string;
  userEmail: string;
  initialUnread: number;
}) {
  return (
    <header className="flex h-[var(--toph)] items-center gap-3.5 border-b border-line bg-surface px-pad">
      <LeftToggle />
      <Link
        href="/pipeline"
        className="flex items-center gap-[9px] font-disp text-[15px] font-extrabold tracking-[-0.01em] text-fg"
      >
        <Logo size={22} className="rounded-[7px]" />
        Tess Portal
      </Link>

      <div className="flex flex-1 justify-center">
        <SearchCommand />
      </div>

      <div className="flex items-center gap-3">
        <span className="rounded-pill border border-line bg-bg px-[11px] py-[5px] font-mono text-[11px] text-muted">
          Cost <b className="font-medium text-jade">$0.00</b> / $40
        </span>
        <ThemeToggle />
        <NotificationBell initialUnread={initialUnread} />
        <UserMenu name={userName} email={userEmail} />
        <RightToggle />
      </div>
    </header>
  );
}
