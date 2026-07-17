import { getLogger } from "@/lib/server/health";

/**
 * PDF generation. The chosen engine is Playwright print-to-PDF, and the
 * browsers live in the worker container. The web app posts HTML to the
 * worker's internal render endpoint over the private network and gets
 * back a PDF. The endpoint is not on the edge network and requires a
 * shared token.
 */
export async function renderPdf(html: string): Promise<Buffer> {
  const base = process.env.WORKER_INTERNAL_URL ?? "http://tessportal-worker:3001";
  const token = process.env.SESSION_SECRET ?? "";
  const res = await fetch(`${base}/render/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-render-token": token },
    body: JSON.stringify({ html }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    getLogger().error({ status: res.status }, "pdf render failed");
    throw new Error("could not generate the PDF");
  }
  return Buffer.from(await res.arrayBuffer());
}
