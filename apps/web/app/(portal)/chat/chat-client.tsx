"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useChat } from "ai/react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { ApprovalCard } from "@/components/approval-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

type ToolCallRecord = { tool: string; args: unknown; result: unknown };

function approvalFromResult(result: unknown) {
  const r = result as { approvalRequired?: boolean; approvalId?: string; title?: string; summary?: string } | null;
  if (r && r.approvalRequired && r.approvalId) {
    return { approvalId: r.approvalId, title: r.title ?? "Approval needed", summary: r.summary ?? "" };
  }
  return null;
}

export function ChatClient(props: {
  paused: boolean;
  conversations: { id: string; title: string; updatedAt: string }[];
  selectedId: string | null;
  selectedModel: string | null;
  defaultModelLabel: string;
  models: ModelOption[];
  initialMessages: { id: string; role: "user" | "assistant"; content: string }[];
  historicalToolCalls: Record<string, ToolCallRecord[]>;
}) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [model, setModel] = React.useState(props.selectedModel);
  const pickerRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: "/api/chat",
    id: props.selectedId ?? "none",
    initialMessages: props.initialMessages,
    experimental_prepareRequestBody: ({ messages }) => ({
      conversationId: props.selectedId,
      message: String(messages[messages.length - 1]?.content ?? ""),
    }),
    onFinish: () => router.refresh(),
  });

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, isLoading]);

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function newConversation() {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.ok) {
      const { id } = (await res.json()) as { id: string };
      router.push(`/chat?c=${id}`);
      router.refresh();
    }
  }

  async function removeConversation(id: string) {
    await fetch("/api/conversations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (id === props.selectedId) router.push("/chat");
    router.refresh();
  }

  async function pickModel(value: string | null) {
    setModel(value);
    setPickerOpen(false);
    if (props.selectedId) {
      await fetch("/api/conversations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: props.selectedId, model: value }),
      });
    }
  }

  const currentLabel = model
    ? (() => {
        const [p, ...rest] = model.split(":");
        const hit = props.models.find((m) => m.provider === p && m.modelId === rest.join(":"));
        return hit ? `${hit.providerName} · ${hit.label}` : model;
      })()
    : `Default (${props.defaultModelLabel})`;

  return (
    <div className="flex h-[calc(100vh-var(--toph)-2*var(--pad))] gap-gap">
      {/* conversation list */}
      <div className="flex w-[230px] shrink-0 flex-col rounded-card border border-line bg-surface">
        <div className="flex items-center gap-2 p-cardpad pb-2.5">
          <h2 className="font-disp text-[13.5px] font-bold">Conversations</h2>
          <button
            type="button"
            onClick={newConversation}
            aria-label="New conversation"
            className="ml-auto flex h-[24px] w-[24px] items-center justify-center rounded-[7px] border border-line text-muted hover:bg-raised hover:text-fg"
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-1.5">
          {props.conversations.length === 0 ? (
            <p className="px-2.5 py-2 text-[11.5px] text-faint">Nothing yet. Start one.</p>
          ) : (
            props.conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group mb-px flex items-center gap-1.5 rounded-[8px] px-2.5 py-[6px]",
                  c.id === props.selectedId ? "bg-jade-dim" : "hover:bg-raised",
                )}
              >
                <button
                  type="button"
                  onClick={() => router.push(`/chat?c=${c.id}`)}
                  className={cn(
                    "min-w-0 flex-1 truncate text-left text-[12px] font-medium",
                    c.id === props.selectedId ? "text-jade" : "text-muted",
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
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* chat area */}
      <div className="flex min-w-0 flex-1 flex-col rounded-card border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line p-cardpad py-2.5">
          <h2 className="font-disp text-[13.5px] font-bold">Tess</h2>
          {/* the brain picker */}
          <div className="relative ml-auto" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-[8px] border border-line bg-bg px-2.5 py-[5px] font-mono text-[10.5px] text-muted hover:bg-raised hover:text-fg"
            >
              {currentLabel}
              <ChevronDown size={12} />
            </button>
            {pickerOpen ? (
              <div className="absolute right-0 top-[34px] z-40 w-[300px] rounded-[10px] border border-line bg-surface p-1.5">
                <button
                  type="button"
                  onClick={() => pickModel(null)}
                  className={cn(
                    "flex w-full items-center rounded-[7px] px-2.5 py-1.5 text-left text-[12px] hover:bg-raised",
                    !model ? "text-jade" : "text-muted",
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
                      onClick={() => pickModel(value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[12px] hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40",
                        model === value ? "text-jade" : "text-fg",
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
        </div>

        {props.paused ? (
          <div className="border-b border-line bg-red-dim px-cardpad py-2 text-[11.5px] text-red">
            The platform is paused by an admin. Tess is not running anything until it resumes.
          </div>
        ) : null}

        {!props.selectedId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <p className="max-w-[46ch] text-center text-[12.5px] text-muted">
              Talk to Tess here. She plans, researches, and acts, and asks before anything leaves
              the platform.
            </p>
            <Button onClick={newConversation}>Start a conversation</Button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-cardpad">
              {messages.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[78%] rounded-[12px] px-3.5 py-2.5 text-[12.5px] leading-relaxed",
                      m.role === "user" ? "bg-jade-dim text-fg" : "border border-line bg-surface text-fg",
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
                    {/* inline approval cards from live tool results */}
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
                    {/* historical tool calls and approvals from the DB */}
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
                <div className="text-[11.5px] text-faint">Tess is thinking</div>
              ) : null}
              {error ? (
                <div className="rounded-[10px] bg-red-dim px-3 py-2 text-[11.5px] text-red">
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
                className="min-w-0 flex-1 rounded-input border border-line bg-bg px-3 py-[8px] text-[12.5px] text-fg placeholder:text-faint"
              />
              <Button type="submit" disabled={isLoading || props.paused || !input.trim()}>
                Send
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
