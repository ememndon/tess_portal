import { streamText, type CoreMessage } from "ai";
import { z } from "zod";
import { apiUser, sameOrigin } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { getLogger } from "@/lib/server/health";
import { buildSystemPrompt } from "@/lib/tess/persona";
import { buildToolsFor } from "@/lib/tess/tools";
import { resolveModel } from "@/lib/ai/router";
import { isGloballyPaused, recordUsage } from "@/lib/ai/meter";
import { embedText, providerSemaphore } from "@/lib/ai/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().min(1).max(20000),
});

export async function POST(req: Request) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const user = await apiUser();
  if (!user) return jsonError("unauthorized", 401);
  if (await isGloballyPaused()) {
    return jsonError("the platform is paused by an admin, nothing runs until it resumes", 503);
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid input", 400);
  const { conversationId, message } = parsed.data;

  const scope = scopeFor(user.id);
  const conversation = await scope.getConversation(conversationId);
  if (!conversation) return jsonError("conversation not found", 404);

  // brain picker override: "provider:modelId" stored on the conversation
  const override = conversation.model
    ? { provider: conversation.model.split(":")[0], model: conversation.model.split(":").slice(1).join(":") }
    : undefined;
  const resolved = await resolveModel("chat", override);
  if (!resolved) {
    return jsonError("no AI provider is available, add an API key in Admin, Vault", 503);
  }

  const history = await scope.listMessages(conversationId, 40);
  const userMessage = await scope.appendMessage(conversationId, "user", message);
  if (history.length === 0) {
    await scope.setConversationTitle(conversationId, message.slice(0, 80));
  }

  // three-layer memory: standing instructions and learned profile ride
  // in the system prompt; semantic recall pulls relevant past talk
  let system = await buildSystemPrompt(user);
  const queryEmbedding = await embedText(user.id, message);
  if (queryEmbedding) {
    scope.setMessageEmbedding(userMessage.id, queryEmbedding).catch(() => {});
    const recalled = await scope.recallMessages(queryEmbedding, conversationId, 5);
    if (recalled.length > 0) {
      system += `\n\nRelevant past discussion with this user, use it as memory:\n${recalled
        .map((r) => `- [${r.createdAt.toISOString().slice(0, 10)}] ${r.role}: ${r.content.slice(0, 280)}`)
        .join("\n")}`;
    }
  }

  const modelMessages: CoreMessage[] = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: message },
  ];

  const log = getLogger();
  const result = await providerSemaphore(resolved.provider).run(async () =>
    streamText({
      model: resolved.model,
      system,
      messages: modelMessages,
      tools: buildToolsFor(user.id, "chat"),
      maxSteps: 8,
      abortSignal: AbortSignal.timeout(110000),
      onFinish: async ({ text, usage, steps }) => {
        try {
          const toolCalls = steps.flatMap((s) =>
            s.toolCalls.map((c, i) => ({
              tool: c.toolName,
              args: c.args,
              result: (s.toolResults[i] as { result?: unknown } | undefined)?.result ?? null,
            })),
          );
          const saved = await scope.appendMessage(
            conversationId,
            "assistant",
            text || "(acted with tools, no text)",
            toolCalls.length > 0 ? toolCalls : null,
          );
          await recordUsage({
            userId: user.id,
            feature: "chat",
            provider: resolved.provider,
            model: resolved.modelId,
            tokensIn: usage.promptTokens ?? 0,
            tokensOut: usage.completionTokens ?? 0,
          });
          if (text) {
            embedText(user.id, text).then((vec) => {
              if (vec) scope.setMessageEmbedding(saved.id, vec).catch(() => {});
            });
          }
        } catch (err) {
          log.error({ err: (err as Error).message }, "chat persistence failed");
        }
      },
    }),
  );

  return result.toDataStreamResponse({
    headers: {
      "x-tess-provider": resolved.provider,
      "x-tess-model": resolved.modelId,
    },
  });
}
