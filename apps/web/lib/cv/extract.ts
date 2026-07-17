import mammoth from "mammoth";

/**
 * CV text extraction. DOCX through mammoth, PDF through pdfjs-dist.
 * The same extractors are reused by the ATS simulation so that what it
 * scores is exactly what an ATS would parse out of the generated file.
 */

export async function extractText(buffer: Buffer, mime: string, fileName: string): Promise<string> {
  const isPdf = mime.includes("pdf") || fileName.toLowerCase().endsWith(".pdf");
  const isDocx =
    mime.includes("word") ||
    mime.includes("officedocument") ||
    fileName.toLowerCase().endsWith(".docx");
  if (isPdf) return extractPdf(buffer);
  if (isDocx) return extractDocx(buffer);
  // plain text or markdown
  return buffer.toString("utf8");
}

export async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractPdf(buffer: Buffer): Promise<string> {
  // pdfjs-dist legacy build runs in Node without a browser worker
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;
  // Bound the work a hostile file can force: a real CV is a few pages, so
  // cap page count and total extracted text. This stops a small-on-disk
  // PDF that declares thousands of pages from pinning a CPU core for the
  // full request budget.
  const MAX_PAGES = 50;
  const MAX_CHARS = 500_000;
  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  const parts: string[] = [];
  let chars = 0;
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    parts.push(line);
    chars += line.length;
    if (chars >= MAX_CHARS) break;
  }
  await doc.cleanup();
  return parts.join("\n").replace(/\s{3,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
