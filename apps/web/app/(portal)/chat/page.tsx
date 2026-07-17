import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { getRouting, listAvailableModels } from "@/lib/ai/router";
import { isGloballyPaused } from "@/lib/ai/meter";
import { ChatClient } from "./chat-client";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const [conversations, models, defaultRouting, paused] = await Promise.all([
    scope.listConversations(),
    listAvailableModels(),
    getRouting("chat"),
    isGloballyPaused(),
  ]);

  const selectedId = c && (await scope.getConversation(c)) ? c : null;
  const selected = selectedId ? conversations.find((c) => c.id === selectedId) ?? null : null;
  const history = selectedId ? await scope.listMessages(selectedId) : [];

  return (
    <ChatClient
      paused={paused}
      conversations={conversations.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt.toISOString(),
      }))}
      selectedId={selectedId}
      selectedModel={selected?.model ?? null}
      defaultModelLabel={
        defaultRouting.provider === "auto"
          ? "Free chain"
          : `${defaultRouting.provider} · ${defaultRouting.model}`
      }
      models={models}
      initialMessages={history.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
      }))}
      historicalToolCalls={Object.fromEntries(
        history
          .filter((m) => m.toolCalls)
          .map((m) => [m.id, m.toolCalls as { tool: string; args: unknown; result: unknown }[]]),
      )}
    />
  );
}
