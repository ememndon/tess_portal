import type { Logger } from "@tessportal/shared";

/**
 * Internal PDF render service. The chosen PDF engine is Playwright
 * print-to-PDF, and the browsers live here in the worker image. The web
 * app posts HTML over the private network with a shared token; this
 * returns the PDF. A single browser is launched lazily and reused.
 */

let browserPromise: Promise<import("playwright").Browser> | null = null;

async function getBrowser(): Promise<import("playwright").Browser> {
  if (!browserPromise) {
    browserPromise = import("playwright").then((pw) =>
      pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }),
    );
  }
  return browserPromise;
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle", timeout: 20000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await context.close();
  }
}

/** Handles POST /render/pdf on the worker's health server. */
export async function handleRenderRequest(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
  log: Logger,
): Promise<void> {
  const token = process.env.SESSION_SECRET ?? "";
  if (req.headers["x-render-token"] !== token) {
    res.writeHead(401).end("unauthorized");
    return;
  }
  let body = "";
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5_000_000) {
      res.writeHead(413).end("too large");
      return;
    }
    body += chunk;
  }
  try {
    const { html } = JSON.parse(body) as { html: string };
    if (!html || typeof html !== "string") {
      res.writeHead(400).end("html required");
      return;
    }
    const pdf = await renderHtmlToPdf(html);
    res.writeHead(200, { "content-type": "application/pdf", "content-length": pdf.length });
    res.end(pdf);
  } catch (err) {
    log.error({ err: (err as Error).message }, "pdf render failed");
    res.writeHead(500).end("render failed");
  }
}
