import { AppShell } from "@/components/app-shell";
import { requireOnboardedUser } from "@/lib/server/auth";
import { unreadCount } from "@/lib/server/notify";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOnboardedUser();
  const unread = await unreadCount(user.id);

  return (
    <AppShell userName={user.name} userEmail={user.email} initialUnread={unread}>
      {children}
    </AppShell>
  );
}
