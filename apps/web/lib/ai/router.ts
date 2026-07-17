import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { schema } from "@tessportal/db";
import { getDb } from "../server/db";
import { readSecret } from "../server/vault";
import { getLogger } from "../server/health";
import { modelInfo, providerInfo, PROVIDERS, type ProviderId } from "./catalog";
import { capExceeded, freeTierHasRoom, providerLimits } from "./meter";

const { modelRouting } = schema;

/**
 * The router. Every AI task carries an activity type; the
 * model_routing table maps it to a model. provider "auto" or any
 * unavailable choice walks the free-first chain: Cerebras, Groq,
 * Zhipu, DeepInfra, OpenAI, Anthropic. When the monthly cap is hit,
 * paid providers drop out and the free chain carries everything.
 */

export type ResolvedModel = {
  provider: ProviderId;
  modelId: string;
  model: LanguageModel;
  free: boolean;
};

const keyCache = new Map<string, { value: string | null; at: number }>();

async function apiKey(provider: string): Promise<string | null> {
  const cached = keyCache.get(provider);
  if (cached && Date.now() - cached.at < 30000) return cached.value;
  const value = await readSecret(null, "platform_api_key", provider);
  keyCache.set(provider, { value, at: Date.now() });
  return value;
}

function instantiate(provider: ProviderId, modelId: string, key: string): LanguageModel {
  const info = providerInfo(provider)!;
  if (provider === "openai") return createOpenAI({ apiKey: key })(modelId);
  if (provider === "anthropic") return createAnthropic({ apiKey: key })(modelId);
  return createOpenAICompatible({ name: provider, baseURL: info.baseUrl!, apiKey: key })(modelId);
}

/** A provider is usable when it has a key, is enabled, and fits the budget rules. */
async function usable(provider: ProviderId, wantModel?: string): Promise<ResolvedModel | null> {
  const info = providerInfo(provider);
  if (!info) return null;
  const { enabled } = await providerLimits(provider);
  if (!enabled) return null;
  const key = await apiKey(provider);
  if (!key) return null;

  const chosen = wantModel
    ? info.models.find((m) => m.id === wantModel)
    : info.models.find((m) => m.free) ?? info.models[0];
  if (!chosen) return null;

  if (info.freeTier && chosen.free) {
    if (!(await freeTierHasRoom(provider))) return null;
  } else if (await capExceeded()) {
    // paid call while the cap is spent: locked out, quality degrades
    return null;
  }
  return { provider, modelId: chosen.id, model: instantiate(provider, chosen.id, key), free: chosen.free };
}

/** Walks the chain in locked order and returns the first usable model. */
export async function resolveChain(): Promise<ResolvedModel | null> {
  for (const p of [...PROVIDERS].sort((a, b) => a.chainOrder - b.chainOrder)) {
    const hit = await usable(p.id);
    if (hit) return hit;
  }
  return null;
}

export async function getRouting(activity: string): Promise<{ provider: string; model: string }> {
  const rows = await getDb().select().from(modelRouting).where(eq(modelRouting.activity, activity)).limit(1);
  return rows[0] ?? { provider: "auto", model: "auto" };
}

/**
 * Resolves an activity (or an explicit brain-picker override) to a
 * live model. Explicit choices fall through the chain when their
 * provider is unavailable rather than failing the task.
 */
export async function resolveModel(
  activity: string,
  override?: { provider: string; model: string },
): Promise<ResolvedModel | null> {
  const want = override ?? (await getRouting(activity));
  if (want.provider !== "auto") {
    const info = modelInfo(want.provider, want.model);
    if (info) {
      const hit = await usable(want.provider as ProviderId, want.model);
      if (hit) return hit;
      getLogger().warn({ activity, provider: want.provider }, "routed provider unavailable, walking the chain");
    }
  }
  return resolveChain();
}

/** All models the brain picker can offer right now, with availability. */
export async function listAvailableModels() {
  const out: {
    provider: ProviderId;
    providerName: string;
    modelId: string;
    label: string;
    free: boolean;
    strong: boolean;
    available: boolean;
    reason: string;
  }[] = [];
  const overCap = await capExceeded();
  for (const p of PROVIDERS) {
    const key = await apiKey(p.id);
    const { enabled } = await providerLimits(p.id);
    const freeRoom = p.freeTier ? await freeTierHasRoom(p.id) : true;
    for (const m of p.models) {
      let available = Boolean(key) && enabled;
      let reason = "";
      if (!key) reason = "no API key in the vault";
      else if (!enabled) reason = "provider disabled";
      else if (m.free && p.freeTier && !freeRoom) {
        available = false;
        reason = "free tier used up today";
      } else if (!m.free && overCap) {
        available = false;
        reason = "monthly cap reached, free models only";
      }
      out.push({
        provider: p.id,
        providerName: p.displayName,
        modelId: m.id,
        label: m.label,
        free: m.free,
        strong: m.strong,
        available,
        reason,
      });
    }
  }
  return out;
}
