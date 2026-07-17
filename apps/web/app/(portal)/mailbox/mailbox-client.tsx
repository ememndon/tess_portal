"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { RichEditor } from "./rich-editor";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function htmlToPlain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Addr = { name?: string; address: string };
type Folder = { id: string; name: string; specialUse: string | null; total: number; unread: number };
type Account = {
  email: string;
  displayName: string | null;
  imapHost: string;
  smtpHost: string;
  backfillDone: boolean;
  signatureHtml: string | null;
};
type DraftRow = { id: string; subject: string; toText: string; updatedAt: string };
type ScheduledRow = { id: string; subject: string; to: string; sendAfter: string };
type MsgRow = {
  id: string;
  subject: string | null;
  from: Addr;
  to: Addr[];
  snippet: string | null;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  receivedAt: string;
};
type Body = {
  fetched: boolean;
  html: string;
  text: string;
  hasRemoteImages: boolean;
  subject: string | null;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  sentAt: string | null;
  messageIdHdr: string | null;
  referencesHdrs: string[] | null;
  attachments: { id: string; filename: string; contentType: string; sizeBytes: number }[];
};

const FOLDER_LABEL: Record<string, string> = {
  inbox: "Inbox",
  sent: "Sent",
  drafts: "Drafts",
  trash: "Trash",
  junk: "Spam",
  archive: "Archive",
  all: "All Mail",
  starred: "Starred",
};
const FOLDER_ORDER = ["inbox", "starred", "sent", "drafts", "archive", "junk", "trash", "all"];

function folderName(f: Folder): string {
  return f.specialUse ? FOLDER_LABEL[f.specialUse] ?? f.name : f.name;
}
function label(a?: Addr): string {
  if (!a) return "";
  return a.name || a.address || "";
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
const DANGER_EXT = new Set([
  "exe", "scr", "bat", "cmd", "com", "pif", "msi", "js", "jse", "vbs", "wsf",
  "hta", "jar", "apk", "ps1", "reg", "lnk", "iso", "img",
]);
function isDangerous(filename: string): boolean {
  return DANGER_EXT.has(filename.split(".").pop()?.toLowerCase() ?? "");
}
function uniqueEmails(list: Addr[], exclude: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of list) {
    const e = (a.address || "").toLowerCase();
    if (e && e !== exclude.toLowerCase() && !seen.has(e)) {
      seen.add(e);
      out.push(a.name ? `${a.name} <${a.address}>` : a.address);
    }
  }
  return out;
}

export function MailboxClient(props: {
  connected: boolean;
  account: Account | null;
  folders: Folder[];
  selectedFolderId?: string | null;
  selectedSpecialUse?: string | null;
  q?: string | null;
  hasMore?: boolean;
  messages?: MsgRow[];
  drafts?: DraftRow[];
  scheduled?: ScheduledRow[];
}) {
  if (!props.connected || !props.account) return <ConnectMailbox />;
  return (
    <Inbox
      account={props.account}
      folders={props.folders}
      selectedFolderId={props.selectedFolderId ?? null}
      selectedSpecialUse={props.selectedSpecialUse ?? null}
      q={props.q ?? null}
      hasMore={props.hasMore ?? false}
      messages={props.messages ?? []}
      drafts={props.drafts ?? []}
      scheduled={props.scheduled ?? []}
    />
  );
}

/* ---------- inbox ---------- */

type ComposeInitial = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string; // plaintext quote (for plain-text mode)
  quoteHtml?: string; // HTML body seed (quote and/or signature) for the rich editor
  inReplyTo?: string;
  references?: string;
  draftId?: string;
  plainMode?: boolean;
  attachmentIds?: string[];
  aiDraft?: boolean; // when true, Compose asks Tess to draft on open
};

function Inbox({
  account,
  folders,
  selectedFolderId,
  selectedSpecialUse,
  q,
  hasMore,
  messages,
  drafts,
  scheduled,
}: {
  account: Account;
  folders: Folder[];
  selectedFolderId: string | null;
  selectedSpecialUse: string | null;
  q: string | null;
  hasMore: boolean;
  messages: MsgRow[];
  drafts: DraftRow[];
  scheduled: ScheduledRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [body, setBody] = React.useState<Body | null>(null);
  const [loadingBody, setLoadingBody] = React.useState(false);
  const [loadImages, setLoadImages] = React.useState(false);
  const [compose, setCompose] = React.useState<ComposeInitial | null>(null);
  const [undo, setUndo] = React.useState<{ id: string; seconds: number } | null>(null);
  const [search, setSearch] = React.useState(q ?? "");
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [panel, setPanel] = React.useState<"drafts" | "scheduled" | "signature" | "rules" | "snoozed" | null>(
    null,
  );
  const [cursor, setCursor] = React.useState(-1); // keyboard nav index

  const sortedFolders = [...folders]
    .filter((f) => f.specialUse !== "all" || true)
    .sort((a, b) => {
      const ai = a.specialUse ? FOLDER_ORDER.indexOf(a.specialUse) : 99;
      const bi = b.specialUse ? FOLDER_ORDER.indexOf(b.specialUse) : 99;
      return ai - bi || a.name.localeCompare(b.name);
    });
  const sentView = selectedSpecialUse === "sent" || selectedSpecialUse === "drafts";

  const goFolder = (id: string) => {
    setSelected(null);
    setBody(null);
    router.push(`/mailbox?f=${id}`);
  };
  const runSearch = () => {
    const params = new URLSearchParams();
    if (selectedFolderId) params.set("f", selectedFolderId);
    if (search.trim()) params.set("q", search.trim());
    router.push(`/mailbox?${params.toString()}`);
  };

  async function openMessage(id: string, images = false) {
    setSelected(id);
    setLoadingBody(true);
    setLoadImages(images);
    setBody(null);
    try {
      const res = await fetch("/api/mailbox/body", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id, loadImages: images }),
      });
      const data = (await res.json()) as Body;
      setBody(data);
      router.refresh(); // reflect read state / unread counts
    } catch {
      setBody(null);
    }
    setLoadingBody(false);
  }

  async function op(messageId: string, action: string) {
    await fetch("/api/mailbox/op", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, action }),
    });
    if (["archive", "trash", "spam"].includes(action)) {
      if (selected === messageId) {
        setSelected(null);
        setBody(null);
      }
    }
    router.refresh();
  }

  // signature block prepended above a quote (reply/forward), rich mode only
  const sigBlock = account.signatureHtml ? `<div><br></div>${account.signatureHtml}` : "";

  function startReply(all: boolean, ai = false) {
    if (!body) return;
    const to = all ? uniqueEmails([body.from, ...body.to], account.email) : uniqueEmails([body.from], account.email);
    const cc = all ? uniqueEmails(body.cc, account.email) : [];
    const subject = /^re:/i.test(body.subject ?? "") ? body.subject ?? "" : `Re: ${body.subject ?? ""}`;
    const references = [...(body.referencesHdrs ?? []), body.messageIdHdr].filter(Boolean).join(" ");
    const when = body.sentAt ? new Date(body.sentAt).toLocaleString() : "";
    const who = label(body.from);
    const plain = `\n\nOn ${when}, ${who} wrote:\n${(body.text || "").split("\n").map((l) => `> ${l}`).join("\n")}`;
    const quoteHtml = `${sigBlock}<div><br></div><div style="color:#57606a">On ${when}, ${escapeHtml(who)} wrote:</div><blockquote style="margin:0;border-left:2px solid #d0d7de;padding-left:10px;color:#57606a">${escapeHtml(body.text || "").replace(/\n/g, "<br>")}</blockquote>`;
    setCompose({
      to: to.join(", "),
      cc: cc.join(", "),
      subject,
      body: plain,
      quoteHtml,
      inReplyTo: body.messageIdHdr ?? undefined,
      references: references || undefined,
      aiDraft: ai,
    });
  }
  function startForward() {
    if (!body) return;
    const subject = /^fwd?:/i.test(body.subject ?? "") ? body.subject ?? "" : `Fwd: ${body.subject ?? ""}`;
    const hdr = `From: ${label(body.from)}\nDate: ${body.sentAt ? new Date(body.sentAt).toLocaleString() : ""}\nSubject: ${body.subject ?? ""}`;
    const plain = `\n\n---------- Forwarded message ----------\n${hdr}\n\n${body.text ?? ""}`;
    const quoteHtml = `${sigBlock}<div><br></div><div style="color:#57606a">---------- Forwarded message ----------<br>${escapeHtml(hdr).replace(/\n/g, "<br>")}</div><div>${escapeHtml(body.text || "").replace(/\n/g, "<br>")}</div>`;
    setCompose({ subject, body: plain, quoteHtml });
  }

  const composeNew = () => setCompose({ quoteHtml: sigBlock });

  async function snooze(messageId: string, untilIso: string | null) {
    await fetch("/api/mailbox/snooze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, until: untilIso }),
    });
    if (selected === messageId) {
      setSelected(null);
      setBody(null);
    }
    router.refresh();
  }
  async function bulkSnooze(untilIso: string) {
    const ids = [...checked];
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => snooze(id, untilIso)));
    setChecked(new Set());
  }

  function toggleCheck(id: string) {
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function bulk(action: string) {
    const ids = [...checked];
    if (ids.length === 0) return;
    await Promise.all(
      ids.map((id) =>
        fetch("/api/mailbox/op", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: id, action }),
        }),
      ),
    );
    if (selected && ids.includes(selected) && ["archive", "trash", "spam"].includes(action)) {
      setSelected(null);
      setBody(null);
    }
    setChecked(new Set());
    router.refresh();
  }
  async function openDraft(id: string) {
    try {
      const res = await fetch(`/api/mailbox/draft?id=${id}`);
      const d = (await res.json()) as {
        id?: string;
        toText?: string;
        ccText?: string;
        bccText?: string;
        subject?: string;
        html?: string;
        bodyText?: string;
        plainMode?: boolean;
        attachmentIds?: string[];
        inReplyTo?: string | null;
        referencesHdr?: string | null;
      };
      if (d.id) {
        setPanel(null);
        setCompose({
          draftId: d.id,
          to: d.toText,
          cc: d.ccText,
          bcc: d.bccText,
          subject: d.subject,
          quoteHtml: d.html,
          body: d.bodyText,
          plainMode: d.plainMode,
          attachmentIds: d.attachmentIds ?? [],
          inReplyTo: d.inReplyTo ?? undefined,
          references: d.referencesHdr ?? undefined,
        });
      }
    } catch {
      /* ignore */
    }
  }
  async function cancelScheduled(id: string) {
    await fetch("/api/mailbox/send/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  // keyboard shortcuts (ignored while typing or composing)
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (compose || panel) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => (e.key === "j" ? Math.min(messages.length - 1, c + 1) : Math.max(0, c - 1)));
      } else if ((e.key === "Enter" || e.key === "o") && cursor >= 0 && messages[cursor]) {
        openMessage(messages[cursor].id);
      } else if (e.key === "c") {
        e.preventDefault();
        composeNew();
      } else if (e.key === "/") {
        e.preventDefault();
        document.getElementById("mb-search")?.focus();
      } else if (selected) {
        if (e.key === "r") startReply(false);
        else if (e.key === "a") startReply(true);
        else if (e.key === "f") startForward();
        else if (e.key === "e") op(selected, "archive");
        else if (e.key === "#") op(selected, "trash");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, cursor, selected, compose, panel]);

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">Mailbox</h1>
        <span className="hidden rounded-pill bg-jade-dim px-[9px] py-[3px] text-[11px] font-semibold text-jade sm:inline">
          {account.email}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {drafts.length > 0 ? (
            <button type="button" onClick={() => setPanel("drafts")} className="rounded-pill border border-line px-2.5 py-[4px] text-[11px] text-muted hover:bg-raised">
              Drafts {drafts.length}
            </button>
          ) : null}
          {scheduled.length > 0 ? (
            <button type="button" onClick={() => setPanel("scheduled")} className="rounded-pill border border-line px-2.5 py-[4px] text-[11px] text-muted hover:bg-raised">
              Scheduled {scheduled.length}
            </button>
          ) : null}
          <button type="button" onClick={() => setPanel("snoozed")} title="Snoozed" className="rounded-pill border border-line px-2.5 py-[4px] text-[11px] text-muted hover:bg-raised">
            ⏰ Snoozed
          </button>
          <button type="button" onClick={() => setPanel("rules")} title="Filters & rules" className="rounded-pill border border-line px-2.5 py-[4px] text-[11px] text-muted hover:bg-raised">
            ⚙ Filters
          </button>
          <button type="button" onClick={() => setPanel("signature")} title="Signature" className="rounded-pill border border-line px-2.5 py-[4px] text-[11px] text-muted hover:bg-raised">
            ✒ Signature
          </button>
          <Input
            id="mb-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search  ·  from: is:unread has:attachment"
            className="h-[30px] w-[260px]"
          />
          <Button onClick={composeNew}>New message</Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(300px,360px)_1fr] gap-gap">
        {/* folders */}
        <nav className="min-h-0 overflow-y-auto rounded-card border border-line bg-surface p-2">
          {sortedFolders.map((f) => {
            const active = f.id === selectedFolderId;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => goFolder(f.id)}
                className={cn(
                  "mb-px flex w-full items-center gap-2 rounded-[8px] px-2.5 py-[6px] text-left text-[12px]",
                  active ? "bg-jade-dim font-semibold text-jade" : "text-muted hover:bg-raised",
                )}
              >
                <span className="truncate">{folderName(f)}</span>
                {f.unread > 0 ? (
                  <span className="ml-auto rounded-pill bg-jade px-[6px] text-[10px] font-bold text-[var(--ground)]">
                    {f.unread}
                  </span>
                ) : null}
              </button>
            );
          })}
          <div className="mt-3 border-t border-line pt-2">
            <DisconnectButton />
          </div>
        </nav>

        {/* message list */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
          {checked.size > 0 ? (
            <div className="flex items-center gap-2.5 border-b border-line bg-bg px-3 py-1.5 text-[11px]">
              <span className="text-muted">{checked.size} selected</span>
              <button type="button" onClick={() => bulk("read")} className="font-semibold text-jade">Read</button>
              <button type="button" onClick={() => bulk("star")} className="font-semibold text-jade">Star</button>
              <SnoozeMenu onPick={(iso) => bulkSnooze(iso)} compact />
              <button type="button" onClick={() => bulk("archive")} className="font-semibold text-jade">Archive</button>
              <button type="button" onClick={() => bulk("trash")} className="font-semibold text-red">Trash</button>
              <button type="button" onClick={() => setChecked(new Set())} className="ml-auto text-faint">Clear</button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="p-cardpad text-[12px] text-muted">
                {q ? "No messages match your search." : account.backfillDone ? "No messages here." : "Syncing your mail… messages will appear shortly."}
              </div>
            ) : (
              messages.map((m, i) => {
                const who = sentView ? label(m.to[0]) : label(m.from);
                const active = selected === m.id;
                const cur = i === cursor;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-start gap-1",
                      i > 0 && "border-t border-line",
                      active ? "bg-jade-dim" : cur ? "bg-raised" : "hover:bg-raised",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(m.id)}
                      onChange={() => toggleCheck(m.id)}
                      className="ml-2 mt-[13px] accent-[var(--jade)]"
                      aria-label="select"
                    />
                    <button type="button" onClick={() => openMessage(m.id)} className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-2.5 text-left">
                      <div className="flex items-center gap-2">
                        {!m.isRead ? <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-jade" /> : null}
                        <span className={cn("truncate text-[12px]", m.isRead ? "text-muted" : "font-semibold text-fg")}>{who || "(unknown)"}</span>
                        {m.isStarred ? <span className="text-amber">★</span> : null}
                        {m.hasAttachments ? <span className="text-faint">📎</span> : null}
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{fmtDate(m.receivedAt)}</span>
                      </div>
                      <div className={cn("truncate text-[12px]", m.isRead ? "text-muted" : "text-fg")}>{m.subject || "(no subject)"}</div>
                      {m.snippet ? <div className="truncate text-[11px] text-faint">{m.snippet}</div> : null}
                    </button>
                  </div>
                );
              })
            )}
            {hasMore ? (
              <div className="border-t border-line px-3 py-2 text-[10.5px] text-faint">
                Showing the 50 most recent — search to narrow down.
              </div>
            ) : null}
          </div>
        </div>

        {/* reading pane */}
        <div className="min-h-0 overflow-y-auto rounded-card border border-line bg-surface">
          {!selected ? (
            <div className="flex h-full items-center justify-center p-cardpad text-[12px] text-faint">
              Select a message to read it.
            </div>
          ) : loadingBody || !body ? (
            <div className="p-cardpad text-[12px] text-muted">Loading…</div>
          ) : (
            <Reading
              body={body}
              loadImages={loadImages}
              onLoadImages={() => selected && openMessage(selected, true)}
              onReply={() => startReply(false)}
              onReplyAll={() => startReply(true)}
              onReplyWithTess={() => startReply(false, true)}
              onForward={startForward}
              onArchive={() => selected && op(selected, "archive")}
              onTrash={() => selected && op(selected, "trash")}
              onSpam={() => selected && op(selected, "spam")}
              onSnooze={(iso) => selected && snooze(selected, iso)}
            />
          )}
        </div>
      </div>

      {compose ? (
        <Compose
          initial={compose}
          onClose={() => {
            setCompose(null);
            router.refresh();
          }}
          onSent={(id, seconds) => {
            setCompose(null);
            if (seconds > 0) setUndo({ id, seconds });
            else router.refresh();
          }}
        />
      ) : null}
      {undo ? (
        <UndoToast
          undo={undo}
          onDone={() => {
            setUndo(null);
            router.refresh();
          }}
          onUndone={() => {
            setUndo(null);
            router.refresh();
          }}
        />
      ) : null}

      {panel === "drafts" ? (
        <Panel title="Drafts" onClose={() => setPanel(null)}>
          {drafts.length === 0 ? (
            <p className="text-[12px] text-muted">No saved drafts.</p>
          ) : (
            drafts.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => openDraft(d.id)}
                className="flex w-full flex-col border-b border-line py-2 text-left last:border-0 hover:bg-raised"
              >
                <span className="text-[12px] font-medium text-fg">{d.subject || "(no subject)"}</span>
                <span className="truncate text-[11px] text-muted">
                  To {d.toText || "—"} · {new Date(d.updatedAt).toLocaleString()}
                </span>
              </button>
            ))
          )}
        </Panel>
      ) : null}
      {panel === "scheduled" ? (
        <Panel title="Scheduled" onClose={() => setPanel(null)}>
          {scheduled.length === 0 ? (
            <p className="text-[12px] text-muted">Nothing scheduled.</p>
          ) : (
            scheduled.map((s) => (
              <div key={s.id} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-fg">{s.subject || "(no subject)"}</div>
                  <div className="truncate text-[11px] text-muted">
                    To {s.to} · {new Date(s.sendAfter).toLocaleString()}
                  </div>
                </div>
                <button type="button" onClick={() => cancelScheduled(s.id)} className="text-[11px] font-semibold text-red">
                  Cancel
                </button>
              </div>
            ))
          )}
        </Panel>
      ) : null}
      {panel === "signature" ? (
        <SignatureEditor
          initial={account.signatureHtml ?? ""}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            router.refresh();
          }}
        />
      ) : null}
      {panel === "snoozed" ? (
        <SnoozedPanel
          onClose={() => setPanel(null)}
          onOpen={(id) => {
            setPanel(null);
            openMessage(id);
          }}
          onUnsnooze={(id) => snooze(id, null)}
        />
      ) : null}
      {panel === "rules" ? <RulesPanel folders={folders} onClose={() => setPanel(null)} /> : null}
    </div>
  );
}

function Panel({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={cn(
          "w-full rounded-card border border-line bg-surface p-cardpad shadow-xl",
          wide ? "max-w-[580px]" : "max-w-[460px]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center">
          <span className="font-disp text-[13px] font-bold">{title}</span>
          <button type="button" onClick={onClose} className="ml-auto text-[12px] text-faint hover:text-fg">Close</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function SignatureEditor({ initial, onClose, onSaved }: { initial: string; onClose: () => void; onSaved: () => void }) {
  const [html, setHtml] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  async function save() {
    setBusy(true);
    await fetch("/api/mailbox/signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html }),
    });
    onSaved();
  }
  return (
    <Panel title="Signature" onClose={onClose}>
      <p className="mb-2 text-[11px] text-muted">Added to the bottom of new messages you compose.</p>
      <RichEditor initialHtml={initial} onChange={setHtml} />
      <div className="mt-3">
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save signature"}</Button>
      </div>
    </Panel>
  );
}

function Reading({
  body,
  loadImages,
  onLoadImages,
  onReply,
  onReplyAll,
  onReplyWithTess,
  onForward,
  onArchive,
  onTrash,
  onSpam,
  onSnooze,
}: {
  body: Body;
  loadImages: boolean;
  onLoadImages: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onReplyWithTess: () => void;
  onForward: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onSpam: () => void;
  onSnooze: (iso: string) => void;
}) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(320);

  // Email HTML is authored for a white canvas, so render it on white with
  // dark text (as every major mail client does). Forcing light text here made
  // any plain message invisible against the iframe's default white backdrop.
  const srcDoc = `<!doctype html><html><head><base target="_blank">
    <style>html,body{margin:0}body{padding:14px;font:13.5px/1.55 system-ui,-apple-system,sans-serif;color:#1f2328;background:#ffffff;word-wrap:break-word;overflow-wrap:anywhere}
    a{color:#0b57d0}img{max-width:100%!important;height:auto}blockquote{border-left:2px solid #d0d7de;margin:0;padding-left:10px;color:#57606a}
    table{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${body.html || "<p style='color:#8a8a8a'>(empty message)</p>"}</body></html>`;

  function autosize() {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc?.body) setHeight(Math.min(doc.body.scrollHeight + 24, 4000));
    } catch {
      /* cross-origin (shouldn't happen without scripts) */
    }
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-line px-cardpad py-3">
        <div className="text-[14px] font-bold">{body.subject || "(no subject)"}</div>
        <div className="mt-1 text-[11.5px] text-muted">
          <b className="text-fg">{label(body.from)}</b> &lt;{body.from.address}&gt;
          {body.sentAt ? <span className="ml-2 text-faint">{new Date(body.sentAt).toLocaleString()}</span> : null}
        </div>
        <div className="truncate text-[11px] text-faint">
          to {body.to.map((a) => label(a) || a.address).join(", ")}
          {body.cc.length ? ` · cc ${body.cc.map((a) => label(a) || a.address).join(", ")}` : ""}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button onClick={onReply}>Reply</Button>
          <Button variant="secondary" onClick={onReplyWithTess} title="Open a reply that Tess has drafted for you">✦ Draft reply</Button>
          <Button variant="secondary" onClick={onReplyAll}>Reply all</Button>
          <Button variant="secondary" onClick={onForward}>Forward</Button>
          <SnoozeMenu onPick={onSnooze} />
          <Button variant="ghost" onClick={onArchive}>Archive</Button>
          <Button variant="ghost" onClick={onSpam}>Spam</Button>
          <Button variant="ghost" onClick={onTrash}>Trash</Button>
        </div>
      </div>

      {body.hasRemoteImages && !loadImages ? (
        <div className="flex items-center gap-2 border-b border-line bg-bg px-cardpad py-2 text-[11px] text-muted">
          Images are hidden to protect your privacy.
          <button type="button" onClick={onLoadImages} className="font-semibold text-jade">
            Show images
          </button>
        </div>
      ) : null}

      {body.attachments.length ? (
        <div className="flex flex-wrap gap-2 border-b border-line px-cardpad py-2">
          {body.attachments.map((a) => (
            <a
              key={a.id}
              href={`/api/mailbox/attachment/${a.id}`}
              className="flex items-center gap-1.5 rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-[11px] text-fg hover:bg-raised"
            >
              {isDangerous(a.filename) ? (
                <span title="Could be unsafe — only open files from people you trust" className="text-red">⚠</span>
              ) : (
                <span>📎</span>
              )}
              <span className="max-w-[180px] truncate">{a.filename}</span>
              <span className="text-faint">{fmtSize(a.sizeBytes)}</span>
            </a>
          ))}
        </div>
      ) : null}

      <div className="m-cardpad overflow-hidden rounded-card bg-white shadow-sm">
        <iframe
          ref={iframeRef}
          title="message"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          onLoad={autosize}
          style={{ width: "100%", height, border: "none", background: "#ffffff", display: "block" }}
        />
      </div>
    </div>
  );
}

/* ---------- connect wizard ---------- */

function ConnectMailbox() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [advanced, setAdvanced] = React.useState(false);
  const [imapHost, setImapHost] = React.useState("imap.hostinger.com");
  const [imapPort, setImapPort] = React.useState("993");
  const [smtpHost, setSmtpHost] = React.useState("smtp.hostinger.com");
  const [smtpPort, setSmtpPort] = React.useState("465");
  const [sendTest, setSendTest] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{
    imap?: { ok: boolean; message: string };
    smtp?: { ok: boolean; message: string };
    error?: string;
  } | null>(null);

  async function connect() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/mailbox/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          password,
          imapHost: imapHost.trim(),
          imapPort: Number(imapPort),
          smtpHost: smtpHost.trim(),
          smtpPort: Number(smtpPort),
          sendTest,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        imap?: { ok: boolean; message: string };
        smtp?: { ok: boolean; message: string };
        error?: string;
      };
      if (payload.ok) {
        router.refresh();
        return;
      }
      setResult({ imap: payload.imap, smtp: payload.smtp, error: payload.error });
    } catch {
      setResult({ error: "could not reach the server, try again" });
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">Mailbox</h1>
      <p className="mt-1 text-[12.5px] text-muted">
        Connect your job-applications mailbox to send and read email right here. Works with any
        IMAP/SMTP account — the fields below are pre-filled for Hostinger.
      </p>

      <div className="mt-gap flex flex-col gap-3 rounded-card border border-line bg-surface p-cardpad">
        <div>
          <Label htmlFor="mb-email">Email address</Label>
          <Input id="mb-email" type="email" autoComplete="off" placeholder="jobs@yourdomain.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="mb-name">Display name (optional)</Label>
          <Input id="mb-name" placeholder="Your Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="mb-pass">Mailbox password</Label>
          <Input id="mb-pass" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-[10.5px] text-faint">The password you set when creating the mailbox in Hostinger. Stored encrypted; never shown again.</p>
        </div>
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="self-start text-[11px] font-semibold text-jade">
          {advanced ? "Hide" : "Server settings (advanced)"}
        </button>
        {advanced ? (
          <div className="grid grid-cols-2 gap-2.5 rounded-[10px] bg-bg p-3">
            <div><Label htmlFor="mb-imh">IMAP host</Label><Input id="mb-imh" value={imapHost} onChange={(e) => setImapHost(e.target.value)} /></div>
            <div><Label htmlFor="mb-imp">IMAP port</Label><Input id="mb-imp" value={imapPort} onChange={(e) => setImapPort(e.target.value)} /></div>
            <div><Label htmlFor="mb-smh">SMTP host</Label><Input id="mb-smh" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} /></div>
            <div><Label htmlFor="mb-smp">SMTP port</Label><Input id="mb-smp" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} /></div>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-[11.5px] text-muted">
          <input type="checkbox" checked={sendTest} onChange={(e) => setSendTest(e.target.checked)} className="accent-[var(--jade)]" />
          Send a test email to myself to confirm sending works
        </label>
        {result ? (
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-bg p-3 text-[11.5px]">
            {result.error ? <p className="text-red">{result.error}</p> : null}
            {result.imap ? <p className={result.imap.ok ? "text-jade" : "text-red"}>IMAP (reading): {result.imap.message}</p> : null}
            {result.smtp ? <p className={result.smtp.ok ? "text-jade" : "text-red"}>SMTP (sending): {result.smtp.message}</p> : null}
          </div>
        ) : null}
        <div>
          <Button onClick={connect} disabled={busy || !email.trim() || !password}>
            {busy ? "Testing connection…" : "Test & connect"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DisconnectButton() {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  async function disconnect() {
    setBusy(true);
    await fetch("/api/mailbox/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    router.refresh();
  }
  if (!confirming)
    return (
      <button type="button" onClick={() => setConfirming(true)} className="px-2 text-[10.5px] text-faint hover:text-red">
        Disconnect mailbox
      </button>
    );
  return (
    <div className="flex flex-col gap-1.5 px-2 text-[10.5px]">
      <span className="text-muted">Remove this mailbox?</span>
      <div className="flex gap-1.5">
        <button type="button" onClick={disconnect} disabled={busy} className="font-semibold text-red">Yes</button>
        <button type="button" onClick={() => setConfirming(false)} className="text-muted">No</button>
      </div>
    </div>
  );
}

/* ---------- compose (plain-text with reply/forward quoting) ---------- */

function parseRecipients(raw: string): { name?: string; address: string }[] {
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*)<([^>]+)>$/);
      if (m) return { name: m[1].trim() || undefined, address: m[2].trim() };
      return { address: s };
    })
    .filter((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.address));
}

type Att = { key: string; id?: string; filename: string; sizeBytes: number; uploading: boolean; error?: boolean };

function Compose({
  initial,
  onClose,
  onSent,
}: {
  initial: ComposeInitial;
  onClose: () => void;
  onSent: (id: string, seconds: number) => void;
}) {
  const [to, setTo] = React.useState(initial.to ?? "");
  const [cc, setCc] = React.useState(initial.cc ?? "");
  const [bcc, setBcc] = React.useState(initial.bcc ?? "");
  const [showCc, setShowCc] = React.useState(Boolean(initial.cc));
  const [showBcc, setShowBcc] = React.useState(Boolean(initial.bcc));
  const [subject, setSubject] = React.useState(initial.subject ?? "");
  const [plainMode, setPlainMode] = React.useState(Boolean(initial.plainMode));
  const [html, setHtml] = React.useState(initial.quoteHtml ?? "");
  const [text, setText] = React.useState(initial.body ?? "");
  const [attachments, setAttachments] = React.useState<Att[]>(
    (initial.attachmentIds ?? []).map((id) => ({ key: id, id, filename: "attachment", sizeBytes: 0, uploading: false })),
  );
  const [draftId, setDraftId] = React.useState<string | undefined>(initial.draftId);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [editorKey, setEditorKey] = React.useState(0); // remount the rich editor when we set its HTML from code
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiInstruction, setAiInstruction] = React.useState("");
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const aiKicked = React.useRef(false);

  const uploading = attachments.some((a) => a.uploading);

  async function runAiDraft() {
    setAiBusy(true);
    setAiError(null);
    const mode = initial.inReplyTo ? "reply" : subject.startsWith("Fwd") ? "forward" : "new";
    // only send the thread text as context for replies/forwards, never a new message's signature
    const quoted = mode === "new" ? undefined : plainMode ? text : htmlToPlain(html);
    try {
      const res = await fetch("/api/mailbox/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, to, subject, quoted, instruction: aiInstruction.trim() || undefined }),
      });
      const p = (await res.json().catch(() => ({}))) as { body?: string; subject?: string; error?: string };
      if (!res.ok || !p.body) {
        setAiError(p.error ?? "Tess could not draft this, try again");
        setAiBusy(false);
        return;
      }
      if (mode === "new" && !subject.trim() && p.subject) setSubject(p.subject);
      if (plainMode) {
        setText(p.body + (text.trim() ? `\n\n${text}` : ""));
      } else {
        // convert the plain draft to simple HTML and place it above any quote/signature
        const drafted =
          "<div>" +
          escapeHtml(p.body).replace(/\n\n+/g, "</div><div><br></div><div>").replace(/\n/g, "<br>") +
          "</div><div><br></div>";
        setHtml(drafted + html);
        setEditorKey((k) => k + 1);
      }
      setAiOpen(false);
      setAiInstruction("");
    } catch {
      setAiError("could not reach the server, try again");
    }
    setAiBusy(false);
  }

  // when opened as an AI reply/draft, kick off drafting once on mount
  React.useEffect(() => {
    if (initial.aiDraft && !aiKicked.current) {
      aiKicked.current = true;
      void runAiDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave the draft (debounced) so work is never lost on close/refresh
  React.useEffect(() => {
    const hasContent = to.trim() || subject.trim() || (plainMode ? text.trim() : htmlToPlain(html).trim());
    if (!hasContent) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/mailbox/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: draftId ?? null,
            toText: to,
            ccText: cc,
            bccText: bcc,
            subject,
            html,
            bodyText: text,
            plainMode,
            attachmentIds: attachments.filter((a) => a.id).map((a) => a.id),
            inReplyTo: initial.inReplyTo ?? null,
            referencesHdr: initial.references ?? null,
          }),
        });
        const p = (await res.json().catch(() => ({}))) as { id?: string };
        if (p.id && !draftId) setDraftId(p.id);
      } catch {
        /* ignore autosave failures */
      }
    }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, html, text, plainMode, attachments]);

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = crypto.randomUUID();
      setAttachments((a) => [...a, { key, filename: file.name, sizeBytes: file.size, uploading: true }]);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/mailbox/upload", { method: "POST", body: fd });
        const p = (await res.json().catch(() => ({}))) as { id?: string; sizeBytes?: number; error?: string };
        if (res.ok && p.id) {
          setAttachments((a) => a.map((x) => (x.key === key ? { ...x, id: p.id, sizeBytes: p.sizeBytes ?? x.sizeBytes, uploading: false } : x)));
        } else {
          setAttachments((a) => a.map((x) => (x.key === key ? { ...x, uploading: false, error: true } : x)));
          setError(p.error ?? "an attachment failed to upload");
        }
      } catch {
        setAttachments((a) => a.map((x) => (x.key === key ? { ...x, uploading: false, error: true } : x)));
      }
    }
  }
  function removeAtt(att: Att) {
    setAttachments((a) => a.filter((x) => x.key !== att.key));
    if (att.id) {
      fetch("/api/mailbox/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: att.id }),
      }).catch(() => {});
    }
  }
  function toggleMode() {
    if (plainMode) setHtml(escapeHtml(text).replace(/\n/g, "<br>"));
    else setText(htmlToPlain(html));
    setPlainMode((v) => !v);
  }

  async function send(sendAt?: string) {
    setScheduleOpen(false);
    const recipients = parseRecipients(to);
    const ccList = parseRecipients(cc);
    const bccList = parseRecipients(bcc);
    if (recipients.length === 0) return setError("add at least one valid email address");
    if (uploading) return setError("wait for attachments to finish uploading");
    const plain = plainMode ? text : htmlToPlain(html);
    if (!plain.trim() && attachments.length === 0) return setError("the message is empty");
    if (
      attachments.length === 0 &&
      /\b(attach|attached|attachment)\b/i.test(plain) &&
      !window.confirm("You mention an attachment but haven't added one. Send anyway?")
    )
      return;
    setBusy(true);
    setError(null);
    const attachmentIds = attachments.filter((a) => a.id).map((a) => a.id as string);
    try {
      const payload: Record<string, unknown> = {
        idempotencyKey: crypto.randomUUID(),
        to: recipients,
        cc: ccList.length ? ccList : undefined,
        bcc: bccList.length ? bccList : undefined,
        subject,
        inReplyTo: initial.inReplyTo,
        references: initial.references,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
        draftId,
        sendAt,
      };
      if (plainMode) payload.text = text;
      else payload.html = html || "<br>";
      const res = await fetch("/api/mailbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const p = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; undoSeconds?: number; error?: string };
      if (p.ok && p.id) return onSent(p.id, p.undoSeconds ?? 15);
      setError(p.error ?? "could not send, try again");
    } catch {
      setError("could not reach the server, try again");
    }
    setBusy(false);
  }

  function scheduleAt(preset: "tomorrow" | "monday") {
    const d = new Date();
    if (preset === "tomorrow") {
      d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
    } else {
      d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
      d.setHours(8, 0, 0, 0);
    }
    send(d.toISOString());
  }

  const heading = initial.inReplyTo ? "Reply" : initial.subject?.startsWith("Fwd") ? "Forward" : "New message";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        className={cn("relative w-full max-w-[660px] rounded-card border bg-surface shadow-xl", dragging ? "border-jade" : "border-line")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
        }}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-card bg-jade-dim/60 text-[13px] font-semibold text-jade">
            Drop files to attach
          </div>
        ) : null}
        <div className="flex items-center border-b border-line px-cardpad py-3">
          <span className="font-disp text-[13px] font-bold">{heading}</span>
          <button type="button" onClick={onClose} className="ml-auto text-[12px] text-faint hover:text-fg">Close</button>
        </div>
        <div className="flex flex-col gap-2.5 p-cardpad">
          <div>
            <div className="flex items-center">
              <Label htmlFor="cmp-to">To</Label>
              <div className="ml-auto flex gap-2">
                {!showCc ? <button type="button" onClick={() => setShowCc(true)} className="text-[10.5px] text-jade">Cc</button> : null}
                {!showBcc ? <button type="button" onClick={() => setShowBcc(true)} className="text-[10.5px] text-jade">Bcc</button> : null}
              </div>
            </div>
            <RecipientInput id="cmp-to" placeholder="name@example.com, other@example.com" value={to} onChange={setTo} autoFocus={!initial.to} />
          </div>
          {showCc ? (
            <div>
              <Label htmlFor="cmp-cc">Cc</Label>
              <RecipientInput id="cmp-cc" value={cc} onChange={setCc} />
            </div>
          ) : null}
          {showBcc ? (
            <div>
              <Label htmlFor="cmp-bcc">Bcc</Label>
              <RecipientInput id="cmp-bcc" value={bcc} onChange={setBcc} />
            </div>
          ) : null}
          <div>
            <Label htmlFor="cmp-sub">Subject</Label>
            <Input id="cmp-sub" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5 rounded-[8px] border border-jade-line bg-jade-dim/30 p-2">
            {aiOpen ? (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runAiDraft();
                      }
                    }}
                    placeholder="What should it say? (optional)"
                    className="h-[28px] flex-1 text-[11.5px]"
                    autoFocus
                  />
                  <Button onClick={runAiDraft} disabled={aiBusy}>{aiBusy ? "Drafting…" : "Draft"}</Button>
                  <button type="button" onClick={() => { setAiOpen(false); setAiError(null); }} className="text-[11px] text-faint hover:text-fg">
                    Cancel
                  </button>
                </div>
                <p className="text-[10.5px] text-faint">
                  Tess writes from your confirmed profile{initial.inReplyTo ? " and this thread" : ""}. Review before you send.
                </p>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setAiOpen(true)} className="text-[11px] font-semibold text-jade">
                  ✦ Draft with Tess
                </button>
                {aiBusy ? <span className="text-[11px] text-jade">Tess is drafting…</span> : null}
              </div>
            )}
            {aiError ? <p className="text-[11px] text-red">{aiError}</p> : null}
          </div>

          {plainMode ? (
            <textarea
              rows={11}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full resize-y rounded-input border border-line bg-bg px-3 py-2 text-[12.5px] text-fg"
              placeholder="Write your message…"
            />
          ) : (
            <RichEditor key={editorKey} initialHtml={html} onChange={setHtml} />
          )}

          {attachments.length ? (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span
                  key={a.key}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[8px] border px-2 py-1 text-[11px]",
                    a.error ? "border-red text-red" : "border-line bg-bg text-fg",
                  )}
                >
                  📎 <span className="max-w-[160px] truncate">{a.filename}</span>
                  <span className="text-faint">{a.uploading ? "uploading…" : a.error ? "failed" : fmtSize(a.sizeBytes)}</span>
                  <button type="button" onClick={() => removeAtt(a)} className="text-faint hover:text-red">✕</button>
                </span>
              ))}
            </div>
          ) : null}

          {error ? <p className="text-[11.5px] text-red">{error}</p> : null}

          <div className="relative flex items-center gap-2">
            <Button onClick={() => send()} disabled={busy || uploading}>{busy ? "Queuing…" : "Send"}</Button>
            <button
              type="button"
              onClick={() => setScheduleOpen((v) => !v)}
              disabled={busy || uploading}
              className="rounded-btn border border-line px-2 py-[6px] text-[11px] text-muted hover:bg-raised"
            >
              Schedule ▾
            </button>
            {scheduleOpen ? (
              <div className="absolute bottom-full left-0 mb-1 flex w-[190px] flex-col rounded-card border border-line bg-surface p-1 shadow-lg">
                <button type="button" onClick={() => scheduleAt("tomorrow")} className="rounded-[6px] px-2 py-1.5 text-left text-[11.5px] hover:bg-raised">Tomorrow, 8:00 AM</button>
                <button type="button" onClick={() => scheduleAt("monday")} className="rounded-[6px] px-2 py-1.5 text-left text-[11.5px] hover:bg-raised">Monday, 8:00 AM</button>
              </div>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) upload(e.target.files);
                e.target.value = "";
              }}
            />
            <button type="button" title="Attach files" onClick={() => fileRef.current?.click()} className="rounded-[6px] px-2 py-1 text-[13px] text-muted hover:bg-raised hover:text-fg">📎</button>
            <button type="button" onClick={toggleMode} className="text-[10.5px] text-muted hover:text-fg">
              {plainMode ? "Rich text" : "Plain text"}
            </button>
            <span className="ml-auto text-[10.5px] text-faint">Undo · ⌘/Ctrl+Enter</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function UndoToast({
  undo,
  onDone,
  onUndone,
}: {
  undo: { id: string; seconds: number };
  onDone: () => void;
  onUndone: () => void;
}) {
  const [left, setLeft] = React.useState(undo.seconds);
  React.useEffect(() => {
    if (left <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onDone]);

  async function undoSend() {
    const res = await fetch("/api/mailbox/send/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: undo.id }),
    });
    if (res.ok) onUndone();
    else onDone();
  }

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-pill border border-line bg-raised px-4 py-2.5 text-[12px] text-fg shadow-lg">
      <span>Sending in {left}s…</span>
      <button type="button" onClick={undoSend} className="font-semibold text-jade">Undo</button>
    </div>
  );
}

/* ---------- snooze ---------- */

function snoozePresets(): { key: string; label: string; date: Date }[] {
  const now = new Date();
  const laterToday = new Date(now.getTime() + 3 * 3600 * 1000);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const weekend = new Date(now);
  weekend.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7)); // next Saturday
  weekend.setHours(8, 0, 0, 0);
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7)); // next Monday
  nextWeek.setHours(8, 0, 0, 0);
  return [
    { key: "later", label: "Later today", date: laterToday },
    { key: "tomorrow", label: "Tomorrow", date: tomorrow },
    { key: "weekend", label: "This weekend", date: weekend },
    { key: "nextweek", label: "Next week", date: nextWeek },
  ];
}

function fmtSnooze(d: Date): string {
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function SnoozeMenu({ onPick, compact }: { onPick: (iso: string) => void; compact?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const presets = snoozePresets();
  return (
    <div className="relative inline-block">
      {compact ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="font-semibold text-jade">
          Snooze
        </button>
      ) : (
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          Snooze ▾
        </Button>
      )}
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 flex w-[210px] flex-col rounded-card border border-line bg-surface p-1 shadow-lg">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  onPick(p.date.toISOString());
                  setOpen(false);
                }}
                className="flex items-center justify-between gap-3 rounded-[6px] px-2 py-1.5 text-left text-[11.5px] hover:bg-raised"
              >
                <span className="text-fg">{p.label}</span>
                <span className="text-faint">{fmtSnooze(p.date)}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

type SnoozedRow = { id: string; subject: string | null; from: Addr; snoozedUntil: string };

function SnoozedPanel({
  onClose,
  onOpen,
  onUnsnooze,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  onUnsnooze: (id: string) => void;
}) {
  const [rows, setRows] = React.useState<SnoozedRow[] | null>(null);
  React.useEffect(() => {
    fetch("/api/mailbox/snooze")
      .then((r) => r.json())
      .then((d) => setRows((d.messages ?? []) as SnoozedRow[]))
      .catch(() => setRows([]));
  }, []);
  return (
    <Panel title="Snoozed" onClose={onClose}>
      {rows === null ? (
        <p className="text-[12px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-muted">
          Nothing snoozed. Use “Snooze” on a message to hide it until you want to deal with it.
        </p>
      ) : (
        rows.map((m) => (
          <div key={m.id} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
            <button type="button" onClick={() => onOpen(m.id)} className="min-w-0 flex-1 text-left">
              <div className="truncate text-[12px] text-fg">{m.subject || "(no subject)"}</div>
              <div className="truncate text-[11px] text-muted">
                {label(m.from) || m.from.address} · back {new Date(m.snoozedUntil).toLocaleString()}
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                onUnsnooze(m.id);
                setRows((rs) => (rs ?? []).filter((r) => r.id !== m.id));
              }}
              className="shrink-0 text-[11px] font-semibold text-jade"
            >
              Un-snooze
            </button>
          </div>
        ))
      )}
    </Panel>
  );
}

/* ---------- filters / rules ---------- */

type RuleCond = { field: string; op: string; value?: string };
type RuleActionT = { type: string; folderId?: string };
type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
  conditions: { match: "all" | "any"; rules: RuleCond[] };
  actions: RuleActionT[];
  stopProcessing: boolean;
};

const FIELD_LABEL: Record<string, string> = {
  from: "From",
  to: "To / Cc",
  subject: "Subject",
  has_attachment: "Has attachment",
};
const OP_LABEL: Record<string, string> = {
  contains: "contains",
  not_contains: "doesn’t contain",
  equals: "is exactly",
  is_true: "yes",
  is_false: "no",
};

function summarizeRule(r: Rule, folders: Folder[]): string {
  const conds = (r.conditions?.rules ?? []).map((c) =>
    c.field === "has_attachment"
      ? `has attachment ${c.op === "is_false" ? "no" : "yes"}`
      : `${FIELD_LABEL[c.field] ?? c.field} ${OP_LABEL[c.op] ?? c.op} “${c.value ?? ""}”`,
  );
  const acts = (r.actions ?? []).map((a) => {
    if (a.type === "mark_read") return "mark read";
    if (a.type === "star") return "star";
    if (a.type === "trash") return "delete";
    if (a.type === "move") return `move to ${folders.find((f) => f.id === a.folderId)?.name ?? "folder"}`;
    return a.type;
  });
  const join = r.conditions?.match === "any" ? " or " : " and ";
  return `If ${conds.join(join) || "…"} → ${acts.join(", ") || "…"}`;
}

function RulesPanel({ folders, onClose }: { folders: Folder[]; onClose: () => void }) {
  const [rules, setRules] = React.useState<Rule[] | null>(null);
  const [editing, setEditing] = React.useState<Rule | "new" | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/mailbox/rules");
      const d = await r.json();
      setRules((d.rules ?? []) as Rule[]);
    } catch {
      setRules([]);
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  async function toggle(rule: Rule) {
    await fetch("/api/mailbox/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
    });
    load();
  }
  async function del(id: string) {
    await fetch("/api/mailbox/rules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  }

  if (editing) {
    return (
      <RuleEditor
        folders={folders}
        rule={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <Panel title="Filters & rules" onClose={onClose} wide>
      <p className="mb-2 text-[11px] text-muted">
        Filters run automatically on new mail arriving in your Inbox — sort, star, or file it for you.
      </p>
      {rules === null ? (
        <p className="text-[12px] text-muted">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-[12px] text-muted">No filters yet. Create one to auto-sort incoming mail.</p>
      ) : (
        rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-fg">{r.name}</div>
              <div className="truncate text-[11px] text-muted">{summarizeRule(r, folders)}</div>
            </div>
            <button
              type="button"
              onClick={() => toggle(r)}
              className={cn("shrink-0 text-[11px] font-semibold", r.enabled ? "text-jade" : "text-faint")}
            >
              {r.enabled ? "On" : "Off"}
            </button>
            <button type="button" onClick={() => setEditing(r)} className="shrink-0 text-[11px] text-muted hover:text-fg">
              Edit
            </button>
            <button type="button" onClick={() => del(r.id)} className="shrink-0 text-[11px] text-red">
              Delete
            </button>
          </div>
        ))
      )}
      <div className="mt-3">
        <Button onClick={() => setEditing("new")}>New filter</Button>
      </div>
    </Panel>
  );
}

const selCls = "h-[30px] rounded-input border border-line bg-bg px-2 text-[12px] text-fg";

function RuleEditor({
  folders,
  rule,
  onClose,
  onSaved,
}: {
  folders: Folder[];
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(rule?.name ?? "");
  const [match, setMatch] = React.useState<"all" | "any">(rule?.conditions?.match ?? "all");
  const [conds, setConds] = React.useState<RuleCond[]>(
    rule?.conditions?.rules?.length ? rule.conditions.rules : [{ field: "from", op: "contains", value: "" }],
  );
  const [markRead, setMarkRead] = React.useState(Boolean(rule?.actions.some((a) => a.type === "mark_read")));
  const [star, setStar] = React.useState(Boolean(rule?.actions.some((a) => a.type === "star")));
  const [trash, setTrash] = React.useState(Boolean(rule?.actions.some((a) => a.type === "trash")));
  const [moveFolderId, setMoveFolderId] = React.useState<string>(
    rule?.actions.find((a) => a.type === "move")?.folderId ?? "",
  );
  const [stop, setStop] = React.useState(rule?.stopProcessing ?? true);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  function setCond(i: number, patch: Partial<RuleCond>) {
    setConds((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  const moveTargets = folders.filter((f) => f.specialUse !== "inbox");

  async function save() {
    setErr(null);
    if (!name.trim()) return setErr("Give the filter a name.");
    const cleanConds: RuleCond[] = conds.map((c) =>
      c.field === "has_attachment"
        ? { field: "has_attachment", op: c.op === "is_false" ? "is_false" : "is_true" }
        : { field: c.field, op: c.op, value: (c.value ?? "").trim() },
    );
    if (cleanConds.some((c) => c.field !== "has_attachment" && !c.value))
      return setErr("Fill in a value for each condition.");
    const actions: RuleActionT[] = [];
    if (markRead) actions.push({ type: "mark_read" });
    if (star) actions.push({ type: "star" });
    if (trash) actions.push({ type: "trash" });
    else if (moveFolderId) actions.push({ type: "move", folderId: moveFolderId });
    if (actions.length === 0) return setErr("Choose at least one action.");

    const payload = {
      name: name.trim(),
      enabled: rule?.enabled ?? true,
      conditions: { match, rules: cleanConds },
      actions,
      stopProcessing: stop,
    };
    setBusy(true);
    const res = await fetch("/api/mailbox/rules", {
      method: rule ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule ? { id: rule.id, ...payload } : payload),
    });
    setBusy(false);
    if (res.ok) onSaved();
    else setErr("Could not save the filter.");
  }

  return (
    <Panel title={rule ? "Edit filter" : "New filter"} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div>
          <Label htmlFor="rule-name">Name</Label>
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Recruiter replies" />
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
            <span>Match</span>
            <select value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")} className={selCls}>
              <option value="all">all conditions</option>
              <option value="any">any condition</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            {conds.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <select
                  value={c.field}
                  onChange={(e) => {
                    const field = e.target.value;
                    const op =
                      field === "has_attachment"
                        ? "is_true"
                        : c.op === "is_true" || c.op === "is_false"
                          ? "contains"
                          : c.op;
                    setCond(i, { field, op });
                  }}
                  className={selCls}
                >
                  <option value="from">From</option>
                  <option value="to">To / Cc</option>
                  <option value="subject">Subject</option>
                  <option value="has_attachment">Has attachment</option>
                </select>
                {c.field === "has_attachment" ? (
                  <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} className={selCls}>
                    <option value="is_true">yes</option>
                    <option value="is_false">no</option>
                  </select>
                ) : (
                  <>
                    <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} className={selCls}>
                      <option value="contains">contains</option>
                      <option value="not_contains">doesn’t contain</option>
                      <option value="equals">is exactly</option>
                    </select>
                    <Input
                      value={c.value ?? ""}
                      onChange={(e) => setCond(i, { value: e.target.value })}
                      placeholder="text or email"
                      className="h-[30px] min-w-[140px] flex-1"
                    />
                  </>
                )}
                {conds.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))}
                    className="px-1 text-[13px] text-faint hover:text-red"
                    title="Remove condition"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setConds((cs) => [...cs, { field: "from", op: "contains", value: "" }])}
              className="self-start text-[11px] font-semibold text-jade"
            >
              + Add condition
            </button>
          </div>
        </div>

        <div>
          <div className="mb-1 text-[11px] text-muted">Then</div>
          <div className="flex flex-col gap-1.5 text-[12px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={markRead} onChange={(e) => setMarkRead(e.target.checked)} className="accent-[var(--jade)]" />
              Mark as read
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={star} onChange={(e) => setStar(e.target.checked)} className="accent-[var(--jade)]" />
              Star it
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={trash}
                onChange={(e) => {
                  setTrash(e.target.checked);
                  if (e.target.checked) setMoveFolderId("");
                }}
                className="accent-[var(--jade)]"
              />
              Delete it (move to Trash)
            </label>
            {!trash ? (
              <label className="flex items-center gap-2">
                <span className="w-[76px]">Move to</span>
                <select value={moveFolderId} onChange={(e) => setMoveFolderId(e.target.value)} className={selCls}>
                  <option value="">— don’t move —</option>
                  {moveTargets.map((f) => (
                    <option key={f.id} value={f.id}>
                      {folderName(f)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>

        <label className="flex items-center gap-2 text-[11.5px] text-muted">
          <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} className="accent-[var(--jade)]" />
          Stop running later filters once this one matches
        </label>

        {err ? <p className="text-[11.5px] text-red">{err}</p> : null}
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save filter"}
          </Button>
          <button type="button" onClick={onClose} className="text-[12px] text-muted hover:text-fg">
            Cancel
          </button>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- recipient field with contact autocomplete ---------- */

function RecipientInput({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [items, setItems] = React.useState<{ email: string; name: string | null }[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = (value.split(",").pop() ?? "").trim();

  React.useEffect(() => {
    if (token.length < 2) {
      setOpen(false);
      setItems([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mailbox/contacts?q=${encodeURIComponent(token)}`);
        const d = await res.json();
        const list = (d.contacts ?? []) as { email: string; name: string | null }[];
        setItems(list);
        setActive(0);
        setOpen(list.length > 0);
      } catch {
        /* ignore */
      }
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [token]);

  function choose(c: { email: string; name: string | null }) {
    const parts = value.split(",");
    parts[parts.length - 1] = ` ${c.name ? `${c.name} <${c.email}>` : c.email}`;
    onChange(parts.join(",").replace(/^\s+/, "") + ", ");
    setOpen(false);
    setItems([]);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" || e.key === "Tab") {
            if (items[active]) {
              e.preventDefault();
              choose(items[active]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-[200px] w-full overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-lg">
          {items.map((c, i) => (
            <button
              key={c.email}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
              className={cn(
                "flex w-full flex-col rounded-[6px] px-2 py-1.5 text-left",
                i === active ? "bg-raised" : "hover:bg-raised",
              )}
            >
              <span className="truncate text-[12px] text-fg">{c.name || c.email}</span>
              {c.name ? <span className="truncate text-[10.5px] text-faint">{c.email}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
