import { test, expect } from "@playwright/test";

/**
 * Critical-flow coverage. The public and gate tests always run. The full
 * signed-in journey runs when GATE_USER, GATE_PASS, E2E_EMAIL, and
 * E2E_PASS are set (deploy time), and skips cleanly otherwise so the
 * suite never gives a false red.
 */

test.describe("public surface", () => {
  test("the case study page is public and describes the build", async ({ page }) => {
    const res = await page.goto("/case-study");
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/case-study$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/Eight phases/i)).toBeVisible();
  });

  test("sends strict security headers", async ({ request }) => {
    const res = await request.get("/case-study");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("the gate", () => {
  test("an unauthenticated app route is sent to the gate", async ({ page }) => {
    await page.goto("/pipeline");
    await expect(page).toHaveURL(/\/gate/);
  });

  test("wrong gate credentials are rejected", async ({ page }) => {
    await page.goto("/gate");
    await page.fill('input[name="username"]', "definitely-not-real");
    await page.fill('input[name="password"]', "definitely-not-real");
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page.getByText(/not right|too many|invalid/i)).toBeVisible();
  });
});

const creds = {
  gateUser: process.env.GATE_USER,
  gatePass: process.env.GATE_PASS,
  email: process.env.E2E_EMAIL,
  pass: process.env.E2E_PASS,
};
const haveCreds = Boolean(creds.gateUser && creds.gatePass && creds.email && creds.pass);

test.describe("the signed-in journey", () => {
  test.skip(!haveCreds, "set GATE_USER, GATE_PASS, E2E_EMAIL, E2E_PASS to run the full flow");

  test("gate, login, pipeline, chat", async ({ page }) => {
    await page.goto("/gate");
    await page.fill('input[name="username"]', creds.gateUser!);
    await page.fill('input[name="password"]', creds.gatePass!);
    await page.getByRole("button", { name: /continue/i }).click();

    await page.waitForURL(/\/login/);
    await page.fill('input[name="email"]', creds.email!);
    await page.fill('input[name="password"]', creds.pass!);
    await page.getByRole("button", { name: /sign in|continue|log in/i }).click();

    await page.waitForURL(/\/(pipeline|onboarding)/);
    if (page.url().includes("/pipeline")) {
      await expect(page.getByRole("heading", { name: /pipeline/i })).toBeVisible();
    }

    await page.goto("/chat");
    await expect(page.locator("textarea, input[type=text]").first()).toBeVisible();
  });
});
