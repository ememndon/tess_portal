import { ProxyAgent, fetch as undiciFetch } from "undici";

/**
 * HTTP for adapters. When a proxy URL is given (source toggled proxy
 * on, credentials from the vault) the request goes through it, so
 * scrape traffic uses the proxy only where configured. Polite: a short
 * timeout and a real user agent.
 */
const UA =
  "Mozilla/5.0 (compatible; TessPortal/1.0; +https://career.tessconsole.cloud)";

export async function politeFetch(
  url: string,
  opts: { proxyUrl?: string | null; accept?: string; method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }> {
  const dispatcher = opts.proxyUrl ? new ProxyAgent(opts.proxyUrl) : undefined;
  try {
    const res = await undiciFetch(url, {
      method: opts.method ?? "GET",
      headers: {
        "User-Agent": UA,
        Accept: opts.accept ?? "application/json",
        ...(opts.headers ?? {}),
      },
      body: opts.body,
      dispatcher,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => {});
  }
}
