"use client";

import * as React from "react";
import { useChat } from "ai/react";
import { ChevronDown, MessagesSquare, Plus, Trash2, X } from "lucide-react";
import { ApprovalCard } from "@/components/approval-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

type ModelOption = {
  provider: string;
  providerName: string;
  modelId: string;
  label: string;
  free: boolean;
  strong: boolean;
  available: boolean;
  reason: string;
};

type Convo = { id: string; title: string; updatedAt: string };
type RawMessage = { id: string; role: string; content: string; toolCalls: unknown };
type Meta = { conversations: Convo[]; models: ModelOption[]; defaultModelLabel: string; paused: boolean };
type ToolCallRecord = { tool: string; args: unknown; result: unknown };

function approvalFromResult(result: unknown) {
  const r = result as { approvalRequired?: boolean; approvalId?: string; title?: string; summary?: string } | null;
  if (r && r.approvalRequired && r.approvalId) {
    return { approvalId: r.approvalId, title: r.title ?? "Approval needed", summary: r.summary ?? "" };
  }
  return null;
}

export function TessRail() {
  const { rightOpen, toggleRight } = useShell();
  const [meta, setMeta] = React.useState<Meta | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [thread, setThread] = React.useState<{ model: string | null; messages: RawMessage[] } | null>(null);
  const [listOpen, setListOpen] = React.useState(false);

  const loadMeta = React.useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setMeta((await res.json()) as Meta);
  }, []);

  // load the conversation list the first time the rail is opened
  React.useEffect(() => {
    if (rightOpen && !meta && !loading) {
      setLoading(true);
      loadMeta().finally(() => setLoading(false));
    }
  }, [rightOpen, meta, loading, loadMeta]);

  const selectConversation = React.useCallback(async (id: string) => {
    setSelectedId(id);
    setThread(null);
    setListOpen(false);
    const res = await fetch(`/api/conversations?id=${id}`);
    if (res.ok) setThread((await res.json()) as { model: string | null; messages: RawMessage[] });
  }, []);

  async function newConversation() {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.ok) {
      const { id } = (await res.json()) as { id: string };
      await loadMeta();
      setSelectedId(id);
      setThread({ model: null, messages: [] });
      setListOpen(false);
    }
  }

  async function removeConversation(id: string) {
    await fetch("/api/conversations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (id === selectedId) {
      setSelectedId(null);
      setThread(null);
    }
    await loadMeta();
  }

  const currentTitle = meta?.conversations.find((c) => c.id === selectedId)?.title ?? "Conversations";

  return (
    <div className="flex h-full flex-col border-l border-line bg-surface">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-line px-cardpad py-2.5">
        <span className="font-disp text-[13.5px] font-bold">Tess</span>

        {/* conversation switcher */}
        <div className="relative ml-auto min-w-0">
          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            className="flex max-w-[150px] items-center gap-1.5 rounded-[8px] border border-line bg-bg px-2 py-[5px] text-[11px] text-muted hover:bg-raised hover:text-fg"
          >
            <MessagesSquare size={12} className="shrink-0" />
            <span className="min-w-0 truncate">{currentTitle}</span>
            <ChevronDown size={11} className="shrink-0" />
          </button>
          {listOpen ? (
            <div className="absolute right-0 top-[32px] z-40 max-h-[320px] w-[240px] overflow-y-auto rounded-[10px] border border-line bg-surface p-1.5 shadow-xl">
              {meta && meta.conversations.length > 0 ? (
                meta.conversations.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      "group flex items-center gap-1.5 rounded-[7px] px-2 py-[6px]",
                      c.id === selectedId ? "bg-jade-dim" : "hover:bg-raised",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectConversation(c.id)}
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-[11.5px] font-medium",
                        c.id === selectedId ? "text-jade" : "text-muted",
                      )}
                    >
                      {c.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeConversation(c.id)}
                      aria-label="Delete conversation"
                      className="hidden text-faint hover:text-red group-hover:block"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="px-2 py-2 text-[11px] text-faint">No conversations yet.</p>
              )}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={newConversation}
          aria-label="New conversation"
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] border border-line text-muted hover:bg-raised hover:text-fg"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          onClick={toggleRight}
          aria-label="Close Tess"
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-faint hover:bg-raised hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>

      {meta?.paused ? (
        <div className="border-b border-line bg-red-dim px-cardpad py-2 text-[11px] text-red">
          The platform is paused by an admin. Tess is not running anything until it resumes.
        </div>
      ) : null}

      {/* model picker */}
      {selectedId && meta ? (
        <ModelPicker
          conversationId={selectedId}
          model={thread?.model ?? null}
          models={meta.models}
          defaultModelLabel={meta.defaultModelLabel}
          onChange={(m) => setThread((t) => (t ? { ...t, model: m } : t))}
        />
      ) : null}

      {/* body */}
      {!selectedId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="max-w-[34ch] text-[12px] leading-relaxed text-muted">
            Talk to Tess here. She plans, researches, and acts — and asks before anything leaves the
            platform.
          </p>
          <Button onClick={newConversation}>Start a conversation</Button>
        </div>
      ) : thread ? (
        <TessThread
          key={selectedId}
          conversationId={selectedId}
          initialMessages={thread.messages.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          }))}
          historicalToolCalls={Object.fromEntries(
            thread.messages
              .filter((m) => m.toolCalls)
              .map((m) => [m.id, m.toolCalls as ToolCallRecord[]]),
          )}
          paused={meta?.paused ?? false}
          onFinish={loadMeta}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[11.5px] text-faint">Loading…</div>
      )}
    </div>
  );
}

function ModelPicker(props: {
  conversationId: string;
  model: string | null;
  models: ModelOption[];
  defaultModelLabel: string;
  onChange: (model: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function pick(value: string | null) {
    props.onChange(value);
    setOpen(false);
    await fetch("/api/conversations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: props.conversationId, model: value }),
    });
  }

  const label = props.model
    ? (() => {
        const [p, ...rest] = props.model.split(":");
        const hit = props.models.find((m) => m.provider === p && m.modelId === rest.join(":"));
        return hit ? `${hit.providerName} · ${hit.label}` : props.model;
      })()
    : `Default (${props.defaultModelLabel})`;

  return (
    <div className="relative border-b border-line px-cardpad py-2" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-[8px] border border-line bg-bg px-2.5 py-[5px] font-mono text-[10px] text-muted hover:bg-raised hover:text-fg"
      >
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      {open ? (
        <div className="absolute left-cardpad right-cardpad top-[42px] z-40 max-h-[300px] overflow-y-auto rounded-[10px] border border-line bg-surface p-1.5 shadow-xl">
          <button
            type="button"
            onClick={() => pick(null)}
            className={cn(
              "flex w-full items-center rounded-[7px] px-2.5 py-1.5 text-left text-[11.5px] hover:bg-raised",
              !props.model ? "text-jade" : "text-muted",
            )}
          >
            Default ({props.defaultModelLabel})
          </button>
          <div className="my-1 h-px bg-line" />
          {props.models.map((m) => {
            const value = `${m.provider}:${m.modelId}`;
            return (
              <button
                key={value}
                type="button"
                disabled={!m.available}
                title={m.available ? undefined : m.reason}
                onClick={() => pick(value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[11.5px] hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40",
                  props.model === value ? "text-jade" : "text-fg",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {m.providerName} · {m.label}
                </span>
                {m.free ? (
                  <span className="rounded-pill bg-jade-dim px-[6px] py-px font-mono text-[9px] text-jade">free</span>
                ) : m.strong ? (
                  <span className="rounded-pill bg-track px-[6px] py-px font-mono text-[9px] text-faint">strong</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function TessThread(props: {
  conversationId: string;
  initialMessages: { id: string; role: "user" | "assistant"; content: string }[];
  historicalToolCalls: Record<string, ToolCallRecord[]>;
  paused: boolean;
  onFinish: () => void;
}) {
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: "/api/chat",
    id: props.conversationId,
    initialMessages: props.initialMessages,
    experimental_prepareRequestBody: ({ messages }) => ({
      conversationId: props.conversationId,
      message: String(messages[messages.length - 1]?.content ?? ""),
    }),
    onFinish: props.onFinish,
  });

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, isLoading]);

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto p-cardpad">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[88%] rounded-[12px] px-3 py-2 text-[12px] leading-relaxed",
                m.role === "user" ? "bg-jade-dim text-fg" : "border border-line bg-bg text-fg",
              )}
            >
              {m.role === "assistant" && (m.toolInvocations?.length ?? 0) > 0 ? (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {m.toolInvocations!.map((t) => (
                    <span
                      key={t.toolCallId}
                      className="rounded-pill bg-track px-[7px] py-px font-mono text-[9.5px] text-faint"
                    >
                      {t.toolName}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.role === "assistant"
                ? m.toolInvocations
                    ?.filter((t) => t.state === "result")
                    .map((t) => {
                      const a = approvalFromResult((t as { result?: unknown }).result);
                      return a ? (
                        <div key={t.toolCallId} className="mt-2">
                          <ApprovalCard approvalId={a.approvalId} title={a.title} summary={a.summary} />
                        </div>
                      ) : null;
                    })
                : null}
              {props.historicalToolCalls[m.id] ? (
                <div className="mt-1.5 flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1">
                    {props.historicalToolCalls[m.id].map((t, i) => (
                      <span key={i} className="rounded-pill bg-track px-[7px] py-px font-mono text-[9.5px] text-faint">
                        {t.tool}
                      </span>
                    ))}
                  </div>
                  {props.historicalToolCalls[m.id].map((t, i) => {
                    const a = approvalFromResult(t.result);
                    return a ? (
                      <ApprovalCard key={i} approvalId={a.approvalId} title={a.title} summary={a.summary} initialStatus="pending" />
                    ) : null;
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === "user" ? (
          <div className="text-[11px] text-faint">Tess is thinking…</div>
        ) : null}
        {error ? (
          <div className="rounded-[10px] bg-red-dim px-3 py-2 text-[11px] text-red">
            {error.message.includes("paused")
              ? "The platform is paused. Nothing runs until an admin resumes it."
              : "That did not go through. Send it again, and if it keeps failing check the provider keys in Admin."}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-line p-cardpad">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Talk to Tess"
          disabled={props.paused}
          className="min-w-0 flex-1 rounded-input border border-line bg-bg px-3 py-[8px] text-[12px] text-fg placeholder:text-faint"
        />
        <Button type="submit" disabled={isLoading || props.paused || !input.trim()}>
          Send
        </Button>
      </form>
    </>
  );
}
