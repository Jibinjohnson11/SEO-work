import { expect, test, type APIRequestContext } from "@playwright/test"
import { admin, assertStagingTarget, authUser, createActiveUser, PASSWORD, RUN, sentSince, signIn, testEmail, writesConfigured } from "./support/target"

// @writes @email: email delivery on STAGING only.
//
//   * "outside recipients are refused" always runs: staging is started with EMAIL_ALLOWED_RECIPIENTS
//     (scripts/staging-env.mjs, default @resend.dev), and these tests prove an outside address is
//     stopped by the app before Supabase or Resend is asked to send anything.
//   * "Auth emails" need E2E_SMTP_CONFIGURED=1: staging Supabase Auth sends through Resend SMTP.
//   * "app emails" need E2E_APP_EMAIL=1: the staging app has RESEND_API_KEY + EMAIL_FROM. They turn
//     on notification digests and a daily scheduled report for the run and restore the settings after.
//
// Every recipient is a Resend test inbox (delivered+…@resend.dev) or the reserved, undeliverable
// example.com domain (RFC 2606), so nothing can reach a real person even if a guard failed.

const SMTP = process.env.E2E_SMTP_CONFIGURED === "1"
const APP_EMAIL = process.env.E2E_APP_EMAIL === "1"
const BLOCKED_MESSAGE = "This test environment only sends email to approved test addresses."
const blockedAddress = (label: string) => `e2e-blocked-${RUN}-${label}@example.com`

test.skip(!writesConfigured(), "write tests run only against staging (set E2E_TARGET=staging)")

test.beforeAll(async ({ playwright }, info) => {
  const ctx = await playwright.request.newContext({ baseURL: info.project.use.baseURL })
  await assertStagingTarget(ctx)
  await ctx.dispose()
  // The test process gets the same environment as the server (both started through the staging loader).
  if (!process.env.EMAIL_ALLOWED_RECIPIENTS) throw new Error("EMAIL_ALLOWED_RECIPIENTS is not set: start staging through scripts/staging-env.mjs")
})

test.describe("outside recipients are refused before anything is sent @writes @email", () => {
  test("self-registration with an outside address is refused and creates no account", async ({ page }) => {
    const email = blockedAddress("signup")
    await page.goto("/signup")
    await page.locator("#full_name").fill("E2E Blocked")
    await page.locator("#email").fill(email)
    await page.locator("#password").fill(PASSWORD)
    await page.locator("#confirm").fill(PASSWORD)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page.getByText(BLOCKED_MESSAGE)).toBeVisible()
    expect(await authUser(email)).toBeNull()
  })

  test("a Super Admin cannot invite an outside address", async ({ page }) => {
    const email = blockedAddress("invite")
    await signIn(page, (await createActiveUser("super_admin", "admin-block")).email)
    await page.goto("/admin/interns")
    await page.getByRole("button", { name: "Add Team Member" }).click()
    await page.locator("#full_name").fill("E2E Blocked Invite")
    await page.locator("#email").fill(email)
    await page.getByRole("button", { name: "Send invitation" }).click()
    await expect(page.getByText(BLOCKED_MESSAGE)).toBeVisible()
    expect(await authUser(email)).toBeNull()
    expect((await admin().from("profiles").select("id").eq("email", email)).data).toEqual([])
  })
})

test.describe.serial("Auth emails through staging SMTP @writes @email", () => {
  test.skip(!SMTP, "sends real emails; set E2E_SMTP_CONFIGURED=1 once staging Auth uses Resend SMTP")
  // Registration confirmation, the UI invitation and the reset form are covered in journeys.spec.ts
  // (with the same delivery checks). These cover the admin-triggered re-sends.
  let adminEmail = ""
  test.beforeAll(async () => {
    adminEmail = (await createActiveUser("super_admin", "admin-mail")).email
  })

  async function userActions(page: import("@playwright/test").Page, email: string, item: string) {
    await signIn(page, adminEmail)
    await page.goto("/admin/interns")
    await page.getByRole("textbox", { name: "Search table" }).fill(email) // staging lists many test interns
    await page.getByRole("row").filter({ hasText: email }).getByRole("button", { name: "User actions" }).click()
    await page.getByRole("menuitem", { name: item }).click()
  }

  test("the Super Admin re-sends an invitation", async ({ page }) => {
    const email = testEmail("reinvite")
    const created = await admin().auth.admin.createUser({ email, email_confirm: false, app_metadata: { role: "intern" } })
    if (created.error) throw new Error(created.error.message)
    await admin().from("profiles").insert({ id: created.data.user.id, email, full_name: "E2E Reinvite", role: "intern", status: "invited" })
    const since = Date.now()
    await userActions(page, email, "Resend invitation")
    await expect(page.getByText("Invitation re-sent")).toBeVisible()
    expect(sentSince((await authUser(email))?.invited_at, since)).toBe(true)
  })

  test("the Super Admin sends a password reset", async ({ page }) => {
    const user = await createActiveUser("intern", "admin-reset")
    const since = Date.now()
    await userActions(page, user.email, "Send password reset")
    await expect(page.getByText("Password reset email sent")).toBeVisible()
    expect(sentSince((await authUser(user.email))?.recovery_sent_at, since)).toBe(true)
  })
})

test.describe.serial("app emails: notification digests and scheduled reports @writes @email", () => {
  test.skip(!APP_EMAIL, "sends real emails; set E2E_APP_EMAIL=1 once the staging app has RESEND_API_KEY and EMAIL_FROM")
  const saved: Record<string, unknown> = {}
  let intern = { id: "", email: "" }
  let firstRun: Record<string, unknown> = {}

  async function cron(request: APIRequestContext) {
    const r = await request.get("/api/cron/daily", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, timeout: 330_000 })
    return { status: r.status(), body: (await r.json()) as Record<string, unknown> & { errors: string[] } }
  }

  test.beforeAll(async () => {
    const rows = (await admin().from("application_settings").select("key, value").in("key", ["reports", "notifications"])).data ?? []
    for (const r of rows) saved[r.key] = r.value
    const reports = (saved.reports ?? {}) as Record<string, unknown>
    const notifications = (saved.notifications ?? {}) as Record<string, unknown>
    const up = await admin().from("application_settings").upsert([
      { key: "notifications", value: { deadline_warning_days: 2, ...notifications, email_enabled: true } },
      { key: "reports", value: { timezone: "Asia/Kolkata", ...reports, schedule: "daily", format: "csv", recipients: [testEmail("scheduled-report")] } },
    ])
    if (up.error) throw new Error(up.error.message)
    // Staging holds thousands of unread notifications from earlier test runs. Mark them handled so the
    // job emails only this run's (staging test data only; production is never touched).
    const drain = await admin().from("notifications").update({ emailed_at: new Date().toISOString() }).is("emailed_at", null).is("read_at", null)
    if (drain.error) throw new Error(drain.error.message)
    // Let the job generate (and email) yesterday's scheduled daily report again in this run.
    const old = await admin().from("reports").delete().eq("is_scheduled", true).eq("kind", "daily").is("client_id", null).gte("created_at", new Date(Date.now() - 3 * 86400_000).toISOString())
    if (old.error) throw new Error(old.error.message)

    intern = await createActiveUser("intern", "digest")
    const n = await admin().from("notifications").insert({ user_id: intern.id, type: "e2e", title: `E2E digest ${RUN}`, body: "Delivered by the staging email test." })
    if (n.error) throw new Error(n.error.message)
  })

  test.afterAll(async () => {
    for (const key of ["reports", "notifications"]) {
      if (key in saved) await admin().from("application_settings").upsert({ key, value: saved[key] })
      else await admin().from("application_settings").delete().eq("key", key)
    }
  })

  test("the daily job emails the notification digest and the scheduled report", async ({ request }) => {
    test.setTimeout(400_000)
    const { status, body } = await cron(request)
    firstRun = body
    expect(status, JSON.stringify(body.errors)).toBe(200)
    expect(body.notification_email).toMatch(/^[1-9]\d* of \d+ digests$/)
    expect(String(body.report_email)).toMatch(/^sent 1 of 1$/)
  })

  test("the digest is recorded as emailed and is not sent again", async ({ request }) => {
    const n = await admin().from("notifications").select("emailed_at").eq("user_id", intern.id).single()
    expect(n.data?.emailed_at).not.toBeNull()
    const again = await cron(request)
    expect(again.status, JSON.stringify(again.body.errors)).toBe(200)
    expect(again.body.notification_email).toBe("0 of 0 digests")
    expect(again.body.report).toBe("already generated")
    expect(again.body.report_email).toBe("nothing pending")
  })

  test("the scheduled report is recorded as sent once", async () => {
    const r = await admin().from("reports").select("email_status, email_attempts, emailed_at, email_last_error").eq("id", String(firstRun.report)).single()
    expect(r.data).toMatchObject({ email_status: "sent", email_attempts: 1, email_last_error: null })
    expect(r.data?.emailed_at).not.toBeNull()
  })

  test("a digest for an address outside the allowlist is refused and left un-emailed", async ({ request }) => {
    const email = blockedAddress("digest")
    const u = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, app_metadata: { role: "intern" } })
    if (u.error) throw new Error(u.error.message)
    await admin().from("profiles").insert({ id: u.data.user.id, email, full_name: "E2E Blocked Digest", role: "intern", status: "active" })
    const n = await admin().from("notifications").insert({ user_id: u.data.user.id, type: "e2e", title: `E2E blocked ${RUN}` }).select("id").single()
    if (n.error) throw new Error(n.error.message)
    try {
      const { status, body } = await cron(request)
      expect(status).toBe(500) // the job reports the refused send as a failed step
      expect(body.errors.join("\n")).toContain("not on EMAIL_ALLOWED_RECIPIENTS")
      expect(body.errors.join("\n")).not.toContain(email)
      expect((await admin().from("notifications").select("emailed_at").eq("id", n.data.id).single()).data?.emailed_at).toBeNull()
    } finally {
      // Leave nothing that would fail later runs.
      await admin().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.data.id)
      await admin().from("profiles").update({ status: "disabled" }).eq("id", u.data.user.id)
    }
  })
})
