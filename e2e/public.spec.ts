import { expect, test } from "@playwright/test"

// @readonly: only loads pages and reads endpoints; safe against any environment.

test.describe("public pages and the sign-in gate @readonly", () => {
  test("sign-in, sign-up and password-reset pages render their forms", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
    await expect(page.locator("#email")).toBeVisible()
    await expect(page.locator("#password")).toBeVisible()
    await page.goto("/signup")
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible()
    for (const id of ["#full_name", "#email", "#password", "#confirm"]) await expect(page.locator(id)).toBeVisible()
    await page.goto("/forgot-password")
    await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible()
  })

  for (const path of ["/admin", "/admin/users", "/intern", "/intern/submissions/new", "/portal", "/portal/reports"]) {
    test(`signed-out visitors are sent to sign-in from ${path}`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
    })
  }

  test("an emailed link opens a Continue page and does not use the one-time token", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=not-a-real-token&type=invite")
    await expect(page).toHaveURL(/\/auth\/continue\?/)
    await expect(page.getByRole("heading", { name: "Accept your invitation" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Accept invitation" })).toBeVisible()
  })

  test("an invalid or expired invitation link ends on sign-in with a clear message, never signed in", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=expired-or-invalid-token&type=invite&next=%2F%09%2Fevil.example")
    await expect(page.getByRole("button", { name: "Accept invitation" })).toBeVisible()
    await page.getByRole("button", { name: "Accept invitation" }).click()
    await expect(page).toHaveURL(/\/login\?error=link$/)
    await expect(page.getByText("That link is invalid or has expired. Request a new one.")).toBeVisible()
    await page.goto("/intern")
    await expect(page).toHaveURL(/\/login\?next=%2Fintern$/)
  })

  test("health check reports the app is up", async ({ request }) => {
    const r = await request.get("/api/health")
    expect(r.status()).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  test("the scheduled job refuses requests without its secret", async ({ request }) => {
    expect((await request.get("/api/cron/daily")).status()).toBe(401)
    expect((await request.get("/api/cron/daily", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401)
  })

  test("security headers are sent", async ({ request }) => {
    const h = (await request.get("/login")).headers()
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(h["strict-transport-security"]).toContain("max-age=")
    expect(h["x-frame-options"]).toBe("DENY")
    expect(h["x-content-type-options"]).toBe("nosniff")
  })
})
