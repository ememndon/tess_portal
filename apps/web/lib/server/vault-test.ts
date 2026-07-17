import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { z } from "zod";
import { readSecret } from "./vault";
import { providerInfo } from "../ai/catalog";
import { getLogger } from "./health";

/**
 * Vault credential testing. Each test proves the stored secret works
 * without exposing it: API keys hit the provider's cheapest endpoint,
 * SMTP verifies login and sends one test mail to the requester, IMAP
 * performs a real login, the proxy carries one request and reports the
 * egress IP. Results are sanitized so secret material never reaches
 * the response.
 */

export type TestResult = { ok: boolean; message: string };

function sanitize(message: string, secrets: (string | undefined)[]): string {
  let out = message;
  for (const s of secrets) {
    if (s && s.length >= 1) out = out.split(s).join("[redacted]");
  }
  return out.slice(0, 300);
}

/**
 * Job-search providers are stored under platform_api_key too, but they are
 * not AI providers — they must be tested against their own search APIs, not
 * an LLM /models endpoint. These mirror the worker's discovery adapters.
 */
const JOB_PROVIDERS = new Set(["adzuna", "careerjet", "jsearch", "jooble", "reed"]);
const JOB_UA = "Mozilla/5.0 (compatible; TessPortal/1.0; +https://career.tessconsole.cloud)";
const JOB_EGRESS_IP = process.env.PUBLIC_EGRESS_IP ?? "185.28.22.66";
const JOB_REFERER = process.env.PUBLIC_APP_URL ?? "https://career.tessconsole.cloud/";

/**
 * A 404 or 5xx from these gateways is usually a transient blip; retry once.
 * Uses undici directly (not the framework-patched global fetch, which caused
 * spurious 404s here) and returns the body so a failed test can be diagnosed
 * from the provider's own message.
 */
async function jobFetch(url: string, headers?: Record<string, string>): Promise<{ status: number; ok: boolean; body: string }> {
  const call = () => undiciFetch(url, { headers, signal: AbortSignal.timeout(15000) });
  let res = await call();
  if (res.status >= 500) {
    await new Promise((r) => setTimeout(r, 1200));
    res = await call();
  }
  const body = await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, body };
}

async function testJobProvider(name: string, value: string): Promise<TestResult> {
  try {
    if (name === "adzuna") {
      let creds: { app_id?: string; app_key?: string };
      try {
        creds = JSON.parse(value);
      } catch {
        return { ok: false, message: "the stored value is not valid — re-enter the App ID and App key." };
      }
      if (!creds.app_id || !creds.app_key) return { ok: false, message: "both an App ID and an App key are required." };
      const params = new URLSearchParams({
        app_id: creds.app_id,
        app_key: creds.app_key,
        results_per_page: "1",
        "content-type": "application/json",
      });
      const res = await jobFetch(`https://api.adzuna.com/v1/api/jobs/gb/search/1?${params.toString()}`);
      if (res.ok) return { ok: true, message: "Adzuna accepted the App ID and key." };
      getLogger().warn({ provider: "adzuna", status: res.status, body: sanitize(res.body.slice(0, 200), [creds.app_id, creds.app_key]) }, "job-provider test non-ok");
      if (res.status === 401 || res.status === 403)
        return { ok: false, message: "Adzuna rejected the keys — double-check the App ID and App key are in the right boxes." };
      return { ok: false, message: sanitize(`Adzuna answered ${res.status}. The keys may still be fine, try again shortly.`, [creds.app_id, creds.app_key]) };
    }
    if (name === "careerjet") {
      const params = new URLSearchParams({
        keywords: "developer",
        locale_code: "en_GB",
        page: "1",
        page_size: "1",
        user_ip: JOB_EGRESS_IP,
        user_agent: JOB_UA,
      });
      const auth = `Basic ${Buffer.from(`${value}:`).toString("base64")}`;
      const res = await jobFetch(`https://search.api.careerjet.net/v4/query?${params.toString()}`, {
        Authorization: auth,
        Referer: JOB_REFERER,
      });
      if (res.ok) return { ok: true, message: "Careerjet accepted the key." };
      getLogger().warn({ provider: "careerjet", status: res.status, body: sanitize(res.body.slice(0, 200), [value]) }, "job-provider test non-ok");
      if (res.status === 401 || res.status === 403)
        return { ok: false, message: "Careerjet rejected the key (authentication failed)." };
      return { ok: false, message: `Careerjet answered ${res.status}. The key may still be fine, try again shortly.` };
    }
    if (name === "jsearch") {
      // mirror the worker's real query shape (with country + date_posted)
      const params = new URLSearchParams({
        query: "software developer in United Kingdom",
        country: "gb",
        page: "1",
        num_pages: "1",
        date_posted: "all",
      });
      const res = await jobFetch(`https://jsearch.p.rapidapi.com/search-v2?${params.toString()}`, {
        "X-RapidAPI-Key": value,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      });
      if (res.ok) return { ok: true, message: "JSearch accepted the key." };
      getLogger().warn({ provider: "jsearch", status: res.status, body: sanitize(res.body.slice(0, 250), [value]) }, "job-provider test non-ok");
      if (res.status === 429)
        return { ok: true, message: "JSearch accepted the key — you are over today's free quota right now, but the key works." };
      if (res.status === 401 || res.status === 403)
        return { ok: false, message: "JSearch (RapidAPI) rejected the key — check it, and that you're subscribed to the JSearch API." };
      if (res.status === 404)
        return {
          ok: false,
          message:
            'JSearch returned 404 "endpoint does not exist" — RapidAPI recognizes the key but it is not subscribed to JSearch\'s /search (often the key is from a different RapidAPI app). Open the JSearch by OpenWeb Ninja API, confirm it says Subscribed, and copy its X-RapidAPI-Key from the code snippet into here.',
        };
      return { ok: false, message: `JSearch answered ${res.status}. Try again shortly.` };
    }
    if (name === "reed") {
      const params = new URLSearchParams({ keywords: "developer", resultsToTake: "1" });
      const auth = `Basic ${Buffer.from(`${value}:`).toString("base64")}`;
      const res = await jobFetch(`https://www.reed.co.uk/api/1.0/search?${params.toString()}`, {
        Authorization: auth,
      });
      if (res.ok) return { ok: true, message: "Reed accepted the key." };
      getLogger().warn({ provider: "reed", status: res.status, body: sanitize(res.body.slice(0, 200), [value]) }, "job-provider test non-ok");
      if (res.status === 401 || res.status === 403)
        return { ok: false, message: "Reed rejected the key — check your Reed API key (from reed.co.uk/developers)." };
      return { ok: false, message: `Reed answered ${res.status}. The key may still be fine, try again shortly.` };
    }
    if (name === "jooble") {
      // Jooble is POST-only (key in the URL path), so it can't use jobFetch.
      let jres: { status: number; ok: boolean; body: string };
      try {
        const r = await undiciFetch(`https://jooble.org/api/${value}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywords: "developer", location: "United Kingdom" }),
          signal: AbortSignal.timeout(15000),
        });
        jres = { status: r.status, ok: r.ok, body: await r.text().catch(() => "") };
      } catch (err) {
        return { ok: false, message: sanitize(`could not reach Jooble: ${(err as Error).message}`, [value]) };
      }
      if (jres.ok) return { ok: true, message: "Jooble accepted the key." };
      getLogger().warn({ provider: "jooble", status: jres.status, body: sanitize(jres.body.slice(0, 200), [value]) }, "job-provider test non-ok");
      // Jooble puts the key in the path, so a bad key is a 404.
      if (jres.status === 401 || jres.status === 403 || jres.status === 404)
        return { ok: false, message: "Jooble rejected the key — check your Jooble API key (from jooble.org/api/about)." };
      return { ok: false, message: `Jooble answered ${jres.status}. The key may still be fine, try again shortly.` };
    }
    return { ok: false, message: "no test exists for this provider" };
  } catch (err) {
    return { ok: false, message: sanitize(`could not reach the provider: ${(err as Error).message}`, [value]) };
  }
}

const mailboxSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int(),
  secure: z.coerce.boolean().optional(),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().optional(),
});

async function testApiKey(provider: string, key: string): Promise<TestResult> {
  const info = providerInfo(provider);
  const timeout = AbortSignal.timeout(12000);
  try {
    let url: string;
    let headers: Record<string, string>;
    if (provider === "anthropic") {
      url = "https://api.anthropic.com/v1/models";
      headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    } else if (provider === "openai") {
      url = "https://api.openai.com/v1/models";
      headers = { Authorization: `Bearer ${key}` };
    } else {
      url = `${info?.baseUrl ?? ""}/models`;
      headers = { Authorization: `Bearer ${key}` };
    }
    let res = await fetch(url, { headers, signal: timeout, cache: "no-store" });
    if ((res.status === 404 || res.status === 405) && info?.baseUrl) {
      // provider without a models listing: one-token completion on its free model
      const freeModel = info.models.find((m) => m.free) ?? info.models[0];
      res = await fetch(`${info.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: freeModel.id,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(15000),
      });
    }
    if (res.ok) return { ok: true, message: `${info?.displayName ?? provider} accepted the key.` };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `${info?.displayName ?? provider} rejected the key: authentication failed (${res.status}).` };
    }
    return { ok: false, message: `${info?.displayName ?? provider} answered ${res.status}. The key may still be fine, try again in a minute.` };
  } catch (err) {
    return { ok: false, message: sanitize(`could not reach the provider: ${(err as Error).message}`, [key]) };
  }
}

async function testSmtp(raw: string, sendTestTo: string | null): Promise<TestResult> {
  let cfg: z.infer<typeof mailboxSchema>;
  try {
    cfg = mailboxSchema.parse(JSON.parse(raw));
  } catch {
    return { ok: false, message: "the stored value is not a valid mailbox config, replace it" };
  }
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure === undefined ? cfg.port === 465 : cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 12000,
  });
  try {
    await transport.verify();
  } catch (err) {
    return { ok: false, message: sanitize(`SMTP login failed: ${(err as Error).message}`, [cfg.pass, cfg.user]) + ". Check host, port, the full email address as username, and the password." };
  }
  if (sendTestTo) {
    try {
      await transport.sendMail({
        from: cfg.from || cfg.user,
        to: sendTestTo,
        subject: "Tess Portal test email",
        text: "This is a test email from Tess Portal. Your SMTP credential works.",
      });
      return { ok: true, message: `Login ok. Test email sent to ${sendTestTo}, check the inbox and the sender address.` };
    } catch (err) {
      return { ok: false, message: sanitize(`login ok but sending failed: ${(err as Error).message}`, [cfg.pass, cfg.user]) };
    }
  }
  return { ok: true, message: "SMTP login ok." };
}

async function testImap(raw: string): Promise<TestResult> {
  let cfg: z.infer<typeof mailboxSchema>;
  try {
    cfg = mailboxSchema.parse(JSON.parse(raw));
  } catch {
    return { ok: false, message: "the stored value is not a valid mailbox config, replace it" };
  }
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure === undefined ? cfg.port === 993 : cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    socketTimeout: 12000,
  });
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX", { readOnly: true });
    const count = mailbox.exists;
    await client.logout();
    return { ok: true, message: `IMAP login ok. INBOX has ${count} message${count === 1 ? "" : "s"}.` };
  } catch (err) {
    client.close();
    return { ok: false, message: sanitize(`IMAP login failed: ${(err as Error).message}`, [cfg.pass, cfg.user]) };
  }
}

async function testProxy(raw: string): Promise<TestResult> {
  let cfg: { url: string; user?: string; pass?: string };
  try {
    cfg = JSON.parse(raw) as { url: string; user?: string; pass?: string };
    if (!cfg.url) throw new Error("no url");
  } catch {
    return { ok: false, message: "the stored value is not a valid proxy config, replace it" };
  }
  try {
    const u = new URL(cfg.url);
    if (cfg.user) u.username = cfg.user;
    if (cfg.pass) u.password = cfg.pass;
    const agent = new ProxyAgent(u.toString());
    const res = await undiciFetch("https://api.ipify.org?format=json", {
      dispatcher: agent,
      signal: AbortSignal.timeout(15000),
    });
    await agent.close();
    if (!res.ok) return { ok: false, message: `proxy connected but the test request answered ${res.status}` };
    const body = (await res.json()) as { ip?: string };
    return { ok: true, message: `Proxy works. Egress IP right now: ${body.ip ?? "unknown"}.` };
  } catch (err) {
    return { ok: false, message: sanitize(`proxy request failed: ${(err as Error).message}`, [cfg.pass, cfg.user]) };
  }
}

/**
 * Tests a full mailbox connection (IMAP login + SMTP login, optionally a
 * self test-send) from raw config JSON, for the mailbox connect wizard.
 * Returns each leg separately so the UI can point at the failing stage.
 */
export async function testMailbox(
  imapRaw: string,
  smtpRaw: string,
  sendTestTo: string | null,
): Promise<{ imap: TestResult; smtp: TestResult }> {
  const imap = await testImap(imapRaw);
  const smtp = await testSmtp(smtpRaw, imap.ok ? sendTestTo : null);
  return { imap, smtp };
}

export async function testSecret(
  ownerUserId: string | null,
  kind: string,
  name: string,
  requesterEmail: string,
): Promise<TestResult> {
  const value = await readSecret(ownerUserId, kind, name);
  if (!value) return { ok: false, message: "nothing is stored under this entry" };

  switch (kind) {
    case "platform_api_key":
      // job-search providers live here too but need their own search-API test
      return JOB_PROVIDERS.has(name) ? testJobProvider(name, value) : testApiKey(name, value);
    case "platform_smtp":
      return testSmtp(value, requesterEmail);
    case "user_smtp":
      return testSmtp(value, requesterEmail);
    case "user_imap":
      return testImap(value);
    case "proxy":
      return testProxy(value);
    default:
      return { ok: false, message: "no test exists for this kind" };
  }
}
