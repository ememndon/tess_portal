/**
 * Provider and model catalog. The chain order is locked by the spec:
 * Cerebras, Groq, Zhipu GLM, then paid DeepInfra, then OpenAI, then
 * Anthropic. Prices are USD per million tokens and feed the cost
 * computation on every usage event. Daily free-tier limits are seeded
 * into the providers table as data and metered live in Redis.
 */

export type ProviderId = "cerebras" | "groq" | "zhipu" | "deepinfra" | "openai" | "anthropic";

export type ModelInfo = {
  id: string;
  label: string;
  /** USD per 1M input tokens */
  inPrice: number;
  /** USD per 1M output tokens */
  outPrice: number;
  /** true when calls to it cost the platform nothing */
  free: boolean;
  strong: boolean;
};

export type ProviderInfo = {
  id: ProviderId;
  displayName: string;
  chainOrder: number;
  freeTier: boolean;
  baseUrl?: string;
  defaultDailyLimits: { requests: number; tokens: number } | null;
  models: ModelInfo[];
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "cerebras",
    displayName: "Cerebras",
    chainOrder: 1,
    freeTier: true,
    baseUrl: "https://api.cerebras.ai/v1",
    defaultDailyLimits: { requests: 14400, tokens: 1000000 },
    models: [
      { id: "llama-3.3-70b", label: "Llama 3.3 70B", inPrice: 0, outPrice: 0, free: true, strong: false },
      { id: "gpt-oss-120b", label: "GPT-OSS 120B", inPrice: 0, outPrice: 0, free: true, strong: false },
    ],
  },
  {
    id: "groq",
    displayName: "Groq",
    chainOrder: 2,
    freeTier: true,
    baseUrl: "https://api.groq.com/openai/v1",
    defaultDailyLimits: { requests: 14400, tokens: 500000 },
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", inPrice: 0, outPrice: 0, free: true, strong: false },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", inPrice: 0, outPrice: 0, free: true, strong: false },
    ],
  },
  {
    id: "zhipu",
    displayName: "Zhipu GLM",
    chainOrder: 3,
    freeTier: true,
    baseUrl: "https://api.z.ai/api/paas/v4",
    defaultDailyLimits: { requests: 5000, tokens: 2000000 },
    models: [
      { id: "glm-4.5-flash", label: "GLM 4.5 Flash", inPrice: 0, outPrice: 0, free: true, strong: false },
      { id: "glm-4.6", label: "GLM 4.6", inPrice: 0.6, outPrice: 2.2, free: false, strong: true },
    ],
  },
  {
    id: "deepinfra",
    displayName: "DeepInfra",
    chainOrder: 4,
    freeTier: false,
    baseUrl: "https://api.deepinfra.com/v1/openai",
    defaultDailyLimits: null,
    models: [
      // DeepSeek first: gpt-oss is a reasoning model and can finish a
      // tool-calling turn with all its tokens in the reasoning channel
      { id: "deepseek-ai/DeepSeek-V4-Flash", label: "DeepSeek V4 Flash", inPrice: 0.09, outPrice: 0.18, free: false, strong: true },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", inPrice: 0.09, outPrice: 0.45, free: false, strong: false },
    ],
  },
  {
    id: "openai",
    displayName: "OpenAI",
    chainOrder: 5,
    freeTier: false,
    defaultDailyLimits: null,
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini", inPrice: 0.15, outPrice: 0.6, free: false, strong: false },
      { id: "gpt-4.1", label: "GPT-4.1", inPrice: 2.0, outPrice: 8.0, free: false, strong: true },
    ],
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    chainOrder: 6,
    freeTier: false,
    defaultDailyLimits: null,
    models: [
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", inPrice: 1.0, outPrice: 5.0, free: false, strong: false },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", inPrice: 3.0, outPrice: 15.0, free: false, strong: true },
    ],
  },
];

export const EMBEDDING_MODEL = { provider: "openai" as ProviderId, id: "text-embedding-3-large", inPrice: 0.13 };

export function providerInfo(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function modelInfo(provider: string, model: string): ModelInfo | undefined {
  return providerInfo(provider)?.models.find((m) => m.id === model);
}

export function computeCostUsd(provider: string, model: string, tokensIn: number, tokensOut: number): number {
  if (model === EMBEDDING_MODEL.id) return (tokensIn * EMBEDDING_MODEL.inPrice) / 1_000_000;
  const m = modelInfo(provider, model);
  if (!m) return 0;
  return (tokensIn * m.inPrice + tokensOut * m.outPrice) / 1_000_000;
}

/**
 * Activities and their default routing. provider "auto" walks the
 * free-first chain. High-stakes activities default to strong models,
 * background work to the chain. All of it is editable data in the
 * model_routing table.
 */
export const ACTIVITIES: { activity: string; label: string; provider: string; model: string; highStakes: boolean }[] = [
  { activity: "chat", label: "Chat with Tess", provider: "anthropic", model: "claude-sonnet-4-5", highStakes: true },
  { activity: "cv_parse", label: "CV parsing", provider: "auto", model: "auto", highStakes: false },
  { activity: "cv_tailoring", label: "CV tailoring", provider: "anthropic", model: "claude-sonnet-4-5", highStakes: true },
  { activity: "cover_letter", label: "Cover letters", provider: "anthropic", model: "claude-sonnet-4-5", highStakes: true },
  { activity: "form_answers", label: "Application form answers", provider: "auto", model: "auto", highStakes: false },
  { activity: "outreach_draft", label: "Draft with Tess (email & outreach)", provider: "anthropic", model: "claude-sonnet-4-5", highStakes: true },
  { activity: "interview_prep", label: "Interview prep", provider: "anthropic", model: "claude-sonnet-4-5", highStakes: true },
  { activity: "mock_interview", label: "Mock interview and feedback", provider: "anthropic", model: "claude-sonnet-4-5", highStakes: true },
  { activity: "negotiation", label: "Salary negotiation scripts", provider: "anthropic", model: "claude-sonnet-4-5", highStakes: true },
  { activity: "company_brief", label: "Company research briefs", provider: "auto", model: "auto", highStakes: false },
  { activity: "paste_parse", label: "Paste-in job parsing", provider: "auto", model: "auto", highStakes: false },
  { activity: "classification", label: "Classification and dedup", provider: "auto", model: "auto", highStakes: false },
  { activity: "summarize", label: "Summarizing scraped posts", provider: "auto", model: "auto", highStakes: false },
  { activity: "playbook_step", label: "Playbook steps", provider: "auto", model: "auto", highStakes: false },
];
