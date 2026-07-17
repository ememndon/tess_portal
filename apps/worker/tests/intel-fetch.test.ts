import { describe, expect, it } from "vitest";
import { fetchTextCapped, readableText } from "../src/intel/fetch";

/**
 * Phase 7 SSRF guard. The worker's intelligence fetcher reads
 * user-controlled company websites, so it must refuse to fetch private,
 * loopback, link-local, and CGNAT addresses, and non-http(s) schemes,
 * before any network call. IP-literal targets are rejected without DNS.
 */

describe("worker intel fetch SSRF guard", () => {
  it("refuses loopback, metadata, private, link-local and CGNAT IP literals", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5:6379/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://100.64.0.1/",
      "http://[::1]/",
    ]) {
      expect(await fetchTextCapped(url)).toBeNull();
    }
  });

  it("refuses non-http(s) schemes", async () => {
    expect(await fetchTextCapped("ftp://example.com/x")).toBeNull();
    expect(await fetchTextCapped("file:///etc/passwd")).toBeNull();
    expect(await fetchTextCapped("gopher://127.0.0.1/")).toBeNull();
  });

  it("returns null for an unparseable url rather than throwing", async () => {
    expect(await fetchTextCapped("not a url")).toBeNull();
  });
});

describe("readableText", () => {
  it("strips scripts, styles, and tags", () => {
    const html = "<html><style>.x{}</style><script>evil()</script><body><h1>Hi</h1> <p>there&nbsp;you</p></body></html>";
    const text = readableText(html);
    expect(text).toContain("Hi");
    expect(text).toContain("there you");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("<");
  });
});
