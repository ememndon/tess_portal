import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the critical flows, run against a deployed
 * instance. E2E_BASE_URL points at it (the container IP in-network, or
 * the public domain). Auth-gated flows read credentials from the
 * environment and skip themselves when those are absent, so the suite is
 * always runnable and fully exercised once deploy-time credentials exist.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    // E2E_RESOLVE="host a.b.c.d" pins DNS at the browser (the VPS resolver
    // is flaky for the app's own domain); tests run against real HTTPS
    launchOptions: process.env.E2E_RESOLVE
      ? { args: [`--host-resolver-rules=MAP ${process.env.E2E_RESOLVE}`] }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
