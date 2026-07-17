import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@tessportal/db";
import { decryptSecret, type Logger } from "@tessportal/shared";

/**
 * Embedding pipeline. Primary: OpenAI text-embedding-3-large at 1536
 * dims through the shared pool. Fallback when no OpenAI key is present:
 * local multilingual-e5-small via Transformers.js, projected to 1536
 * by zero-padding so it shares the vector(1536) column and HNSW index.
 *
 * Cross-model comparison (an e5 vector against an OpenAI vector) is not
 * meaningful, but within a single run and within a single degraded
 * period all vectors come from one model, which is what dedup needs.
 * Everything downstream tolerates a null embedding.
 */

const DIM = 1536;
let localPipe: unknown = null;
let localTried = false;

async function openAiKey(db: Db): Promise<string | null> {
  const rows = await db
    .select({ ciphertext: schema.vaultSecrets.ciphertext })
    .from(schema.vaultSecrets)
    .where(
      and(
        isNull(schema.vaultSecrets.userId),
        eq(schema.vaultSecrets.kind, "platform_api_key"),
        eq(schema.vaultSecrets.name, "openai"),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  const master = process.env.VAULT_MASTER_KEY;
  if (!master) return null;
  try {
    return decryptSecret(master, rows[0].ciphertext);
  } catch {
    return null;
  }
}

async function embedOpenAi(key: string, texts: string[]): Promise<number[][] | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "text-embedding-3-large",
        dimensions: DIM,
        input: texts.map((t) => t.slice(0, 8000)),
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return data.data.map((d) => d.embedding);
  } catch {
    return null;
  }
}

async function getLocalPipe(log: Logger): Promise<unknown> {
  if (localTried) return localPipe;
  localTried = true;
  try {
    const mod = (await import("@huggingface/transformers")) as {
      pipeline: (task: string, model: string) => Promise<unknown>;
      env: { cacheDir?: string; allowRemoteModels?: boolean };
    };
    mod.env.cacheDir = process.env.TRANSFORMERS_CACHE ?? "/app/.cache/transformers";
    mod.env.allowRemoteModels = true;
    log.info("loading local embedding model multilingual-e5-small");
    localPipe = await mod.pipeline("feature-extraction", "Xenova/multilingual-e5-small");
    log.info("local embedding model ready");
  } catch (err) {
    log.warn({ err: (err as Error).message }, "local embedding model unavailable");
    localPipe = null;
  }
  return localPipe;
}

async function embedLocal(log: Logger, texts: string[]): Promise<number[][] | null> {
  const pipe = (await getLocalPipe(log)) as
    | ((input: string | string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>)
    | null;
  if (!pipe) return null;
  try {
    const out: number[][] = [];
    for (const t of texts) {
      const result = await pipe(`query: ${t.slice(0, 4000)}`, { pooling: "mean", normalize: true });
      const vec = Array.from(result.data as Float32Array);
      // pad 384 -> 1536 with zeros; zeros preserve cosine among e5 vectors
      while (vec.length < DIM) vec.push(0);
      out.push(vec.slice(0, DIM));
    }
    return out;
  } catch (err) {
    log.warn({ err: (err as Error).message }, "local embedding failed");
    return null;
  }
}

export type Embedder = {
  provider: "openai" | "local" | "none";
  embed: (texts: string[]) => Promise<(number[] | null)[]>;
};

/** Builds the embedder for a run, choosing the provider once. */
export async function buildEmbedder(db: Db, log: Logger): Promise<Embedder> {
  const key = await openAiKey(db);
  if (key) {
    return {
      provider: "openai",
      embed: async (texts) => {
        const res = await embedOpenAi(key, texts);
        return res ?? texts.map(() => null);
      },
    };
  }
  return {
    provider: "local",
    embed: async (texts) => {
      const res = await embedLocal(log, texts);
      return res ?? texts.map(() => null);
    },
  };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
