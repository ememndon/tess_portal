import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { MailboxClient } from "./mailbox-client";

export const metadata: Metadata = { title: "Mailbox" };
export const dynamic = "force-dynamic";

type Addr = { name?: string; address: string };

export default async function MailboxPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string }>;
}) {
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const account = await scope.getMailAccount();
  if (!account) return <MailboxClient connected={false} account={null} folders={[]} />;

  const sp = await searchParams;
  const [folders, counts, drafts, scheduled] = await Promise.all([
    scope.listMailFolders(),
    scope.mailFolderCounts(),
    scope.listMailDrafts(),
    scope.listScheduledSends(),
  ]);
  const countMap = new Map(counts.map((c) => [c.folderId, c]));
  const foldersWithCounts = folders.map((f) => ({
    id: f.id,
    name: f.name,
    specialUse: f.specialUse,
    total: Number(countMap.get(f.id)?.total ?? 0),
    unread: Number(countMap.get(f.id)?.unread ?? 0),
  }));

  const inbox = folders.find((f) => f.specialUse === "inbox") ?? folders[0];
  const selectedFolderId = sp.f && folders.some((f) => f.id === sp.f) ? sp.f : inbox?.id ?? null;
  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null;
  const q = sp.q?.trim() || null;

  const list = selectedFolderId
    ? await scope.listFolderMessages({ folderId: selectedFolderId, q, limit: 50 })
    : { messages: [], hasMore: false };

  return (
    <MailboxClient
      connected
      account={{
        email: account.email,
        displayName: account.displayName,
        imapHost: account.imapHost,
        smtpHost: account.smtpHost,
        backfillDone: account.backfillDone,
        signatureHtml: account.signatureHtml,
      }}
      drafts={drafts.map((d) => ({
        id: d.id,
        subject: d.subject,
        toText: d.toText,
        updatedAt: d.updatedAt.toISOString(),
      }))}
      scheduled={scheduled.map((s) => {
        const p = s.payload as { subject?: string; to?: { address: string }[] };
        return {
          id: s.id,
          subject: p.subject ?? "",
          to: (p.to ?? []).map((a) => a.address).join(", "),
          sendAfter: s.sendAfter.toISOString(),
        };
      })}
      folders={foldersWithCounts}
      selectedFolderId={selectedFolderId}
      selectedSpecialUse={selectedFolder?.specialUse ?? null}
      q={q}
      hasMore={list.hasMore}
      messages={list.messages.map((m) => ({
        id: m.id,
        subject: m.subject,
        from: (m.fromAddr as Addr) ?? { address: "" },
        to: (m.toAddrs as Addr[]) ?? [],
        snippet: m.snippet,
        isRead: m.isRead,
        isStarred: m.isStarred,
        hasAttachments: m.hasAttachments,
        receivedAt: m.receivedAt.toISOString(),
      }))}
    />
  );
}
