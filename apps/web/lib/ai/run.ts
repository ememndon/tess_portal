import { embed, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { getLogger } from "../server/health";
import { readSecret } from "../server/vault";
import { EMBEDDING_MODEL, PROVIDERS } from "./catalog";
import { isGloballyPaused, recordUsage } from "./meter";
import { resolveChain, resolveModel, type ResolvedModel } from "./router";

/**
 * Background completions through the router. Per-provider concurrency
 * is capped with an in-process queue so one user's batch cannot starve
 * another's chat: excess requests wait rather than fail. Provider
 * errors fall through the chain.
 */

const CONCURRENCY: Record<string, number> = { default: 4 };

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

const g = globalThis as unknown as { __tpSemaphores?: Map<string, Semaphore> };
export function providerSemaphore(provider: string): Semaphore {
  g.__tpSemaphores ??= new Map();
  if (!g.__tpSemaphores.has(provider)) {
    g.__tpSemaphores.set(provider, new Semaphore(CONCURRENCY[provider] ?? CONCURRENCY.default));
  }
  return g.__tpSemaphores.get(provider)!;
}

export class GlobalPauseError extends Error {
  constructor() {
    super("the platform is paused");
  }
}

export async function runCompletion(opts: {
  activity: string;
  userId: string | null;
  system?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ text: string; provider: string; model: string } | null> {
  if (await isGloballyPaused()) throw new GlobalPauseError();
  const tried = new Set<string>();
  let resolved: ResolvedModel | null = await resolveModel(opts.activity);
  while (resolved) {
    tried.add(resolved.provider);
    try {
      const result = await providerSemaphore(resolved.provider).run(() =>
        generateText({
          model: resolved!.model,
          system: opts.system,
          prompt: opts.prompt,
          maxTokens: opts.maxTokens ?? 2000,
          abortSignal: AbortSignal.timeout(90000),
        }),
      );
      await recordUsage({
        userId: opts.userId,
        feature: opts.activity,
        provider: resolved.provider,
        model: resolved.modelId,
        tokensIn: result.usage.promptTokens ?? 0,
        tokensOut: result.usage.completionTokens ?? 0,
      });
      return { text: result.text, provider: resolved.provider, model: resolved.modelId };
    } catch (err) {
      getLogger().warn(
        { provider: resolved.provider, err: (err as Error).message.slice(0, 200) },
        "completion failed, moving down the chain",
      );
      resolved = await resolveChain();
      if (resolved && tried.has(resolved.provider)) {
        // find the next untried provider in chain order
        let next: ResolvedModel | null = null;
        for (const p of PROVIDERS.sort((a, b) => a.chainOrder - b.chainOrder)) {
          if (tried.has(p.id)) continue;
          next = await resolveModel("__chain__", { provider: p.id, model: p.models[0].id });
          if (next && !tried.has(next.provider)) break;
          next = null;
        }
        resolved = next;
      }
    }
  }
  return null;
}

/**
 * Embeddings: text-embedding-3-large at 1536 dimensions through the
 * shared pool. Returns null when no OpenAI key is set; callers degrade
 * gracefully (recall simply finds nothing). The local fallback model
 * arrives with Phase 4's worker pipeline.
 */
export async function embedText(userId: string | null, text: string): Promise<number[] | null> {
  const key = await readSecret(null, "platform_api_key", "openai");
  if (!key) return null;
  try {
    const openai = createOpenAI({ apiKey: key });
    const { embedding, usage } = await embed({
      model: openai.embedding(EMBEDDING_MODEL.id, { dimensions: 1536 }),
      value: text.slice(0, 8000),
      abortSignal: AbortSignal.timeout(20000),
    });
    await recordUsage({
      userId,
      feature: "embedding",
      provider: "openai",
      model: EMBEDDING_MODEL.id,
      tokensIn: usage.tokens ?? 0,
      tokensOut: 0,
    });
    return embedding;
  } catch (err) {
    getLogger().warn({ err: (err as Error).message.slice(0, 200) }, "embedding failed");
    return null;
  }
}
