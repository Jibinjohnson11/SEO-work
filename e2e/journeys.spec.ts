import { expect, test } from "@playwright/test"
import { admin, assertStagingTarget, authUser, createActiveUser, createWorkspace, emailLinkPath, PASSWORD, sentSince, signIn, testEmail, writesConfigured } from "./support/target"

// @writes: full user journeys. They create users, a client, a campaign, submissions and files, so
// they run ONLY against a staging Supabase project (E2E_TARGET=staging); assertStagingTarget()
// refuses production before anything is written. Emails are not read from an inbox: the one-time
// links are generated with the Admin API (exactly what the email template would contain), except in
// the tests marked "needs SMTP", which exercise real sending.

const SMTP = process.env.E2E_SMTP_CONFIGURED === "1"
test.skip(!writesConfigured(), "write tests run only against staging (set E2E_TARGET=staging)")

test.beforeAll(async ({ playwright }, info) => {
  const ctx = await playwright.request.newContext({ baseURL: info.project.use.baseURL })
  await assertStagingTarget(ctx)
  await ctx.dispose()
})

test.describe.serial("registration → email confirmation → pending → approval → dashboard @writes", () => {
  const email = testEmail("signup")
  let adminEmail = ""

  test.beforeAll(async () => {
    adminEmail = (await createActiveUser("super_admin", "admin-reg")).email
  })

  test("registration form creates an account and asks to confirm the email (needs SMTP)", async ({ page }) => {
    test.skip(!SMTP, "sends a real confirmation email; set E2E_SMTP_CONFIGURED=1 once staging has custom SMTP")
    const since = Date.now()
    await page.goto("/signup")
    await page.locator("#full_name").fill("E2E Signup")
    await page.locator("#email").fill(email)
    await page.locator("#password").fill(PASSWORD)
    await page.locator("#confirm").fill(PASSWORD)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page.getByText("Check your email to confirm your address")).toBeVisible()
    // Supabase records the hand-off to SMTP; an SMTP failure would have returned an error instead.
    expect(sentSince((await authUser(email))?.confirmation_sent_at, since)).toBe(true)
  })

  test("the confirmation link (Continue page) confirms the email and shows the pending page", async ({ page }) => {
    // Without SMTP, create the unconfirmed self-registration directly (same metadata as the form).
    if (!SMTP) {
      const r = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: false, user_metadata: { full_name: "E2E Signup", self_signup: true } })
      if (r.error) throw new Error(r.error.message)
    }
    await page.goto(await emailLinkPath("signup", email))
    await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible()
    await page.getByRole("button", { name: "Confirm email" }).click()
    await expect(page.getByText("Your account is awaiting administrator approval")).toBeVisible()
  })

  test("a pending account cannot open any dashboard", async ({ page }) => {
    await signIn(page, email)
    await expect(page).toHaveURL(/\/access$/)
    for (const path of ["/admin", "/intern", "/portal"]) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/access$/)
    }
  })

  test("the Super Admin approves the account as an intern", async ({ page }) => {
    await signIn(page, adminEmail)
    await page.goto("/admin/users?status=pending")
    const row = page.getByRole("row").filter({ hasText: email })
    await row.getByRole("button", { name: "Approve…" }).click()
    await page.locator("#approve-role").selectOption("intern")
    // The intern should get the role's default features: make sure "Follow role defaults" is on.
    const defaults = page.getByRole("dialog").getByRole("switch", { name: "Follow role defaults" })
    if (!(await defaults.isChecked())) await defaults.click()
    await expect(defaults).toBeChecked()
    await page.getByRole("button", { name: "Approve account" }).click()
    await expect(page.getByText("Account approved")).toBeVisible()
    const p = await admin().from("profiles").select("role, status, permissions").eq("email", email).single()
    expect(p.data).toEqual({ role: "intern", status: "active", permissions: null }) // null = follows role defaults
  })

  test("after approval the user lands on the intern dashboard and cannot open admin or portal", async ({ page }) => {
    await signIn(page, email)
    await expect(page).toHaveURL(/\/intern/)
    await page.goto("/admin")
    await expect(page).not.toHaveURL(/\/admin/)
    await page.goto("/portal")
    await expect(page).not.toHaveURL(/\/portal/)
  })
})

test.describe.serial("approval with zero features stays restricted @writes", () => {
  const email = testEmail("zero-features")
  let adminEmail = ""

  test.beforeAll(async () => {
    adminEmail = (await createActiveUser("super_admin", "admin-zero")).email
    // A confirmed self-registration: the signup trigger gives it a pending profile with no role.
    const r = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "E2E Zero Features", self_signup: true } })
    if (r.error) throw new Error(r.error.message)
  })

  test("a Super Admin can deliberately approve an account with no features", async ({ page }) => {
    await signIn(page, adminEmail)
    await page.goto("/admin/users?status=pending")
    await page.getByRole("row").filter({ hasText: email }).getByRole("button", { name: "Approve…" }).click()
    await page.locator("#approve-role").selectOption("intern")
    const defaults = page.getByRole("dialog").getByRole("switch", { name: "Follow role defaults" })
    await expect(defaults).toBeChecked() // the new default
    await defaults.click() // switch to an explicit list...
    await expect(defaults).not.toBeChecked()
    // ...and select no features. The dialog has two pickers with a "None" button (campaigns and
    // features); the feature picker's footer is the one counting "N of M enabled".
    const featureFooter = page.getByRole("dialog").getByText(/^\d+ of \d+ enabled$/).locator("..")
    await featureFooter.getByRole("button", { name: "None", exact: true }).click()
    await expect(featureFooter.getByText(/^0 of \d+ enabled$/)).toBeVisible()
    await expect(page.getByText("No features selected")).toBeVisible()
    await page.getByRole("button", { name: "Approve account" }).click()
    await expect(page.getByText("Account approved")).toBeVisible()
    const p = await admin().from("profiles").select("role, status, permissions").eq("email", email).single()
    expect(p.data).toEqual({ role: "intern", status: "active", permissions: [] })
  })

  test("the zero-feature account can sign in but every dashboard page stays closed", async ({ page }) => {
    await signIn(page, email)
    await expect(page).toHaveURL(/\/access$/)
    // The page heading has role="status" (Next.js's route announcer repeats the same text).
    await expect(page.getByRole("status").filter({ hasText: "No features have been enabled for your account yet" })).toBeVisible()
    for (const path of ["/intern", "/intern/tasks", "/intern/submissions", "/intern/submissions/new", "/intern/campaigns", "/admin", "/portal"]) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/access$/)
    }
  })
})

test.describe.serial("invitation → accept → set password → dashboard @writes", () => {
  test("the Super Admin sends an invitation from the Interns page (needs SMTP)", async ({ page }) => {
    test.skip(!SMTP, "sends a real invitation email; set E2E_SMTP_CONFIGURED=1 once staging has custom SMTP")
    const adminUser = await createActiveUser("super_admin", "admin-inv")
    const since = Date.now()
    await signIn(page, adminUser.email)
    await page.goto("/admin/interns")
    await page.getByRole("button", { name: "Invite intern" }).click()
    await page.locator("#full_name").fill("E2E Invited Intern")
    await page.locator("#email").fill(testEmail("invited-ui"))
    await page.getByRole("button", { name: "Send invitation" }).click()
    await expect(page.getByText("Invitation sent")).toBeVisible()
    expect(sentSince((await authUser(testEmail("invited-ui")))?.invited_at, since)).toBe(true)
  })

  test("an invited intern accepts, sets a password and reaches their dashboard (migration 10 fix)", async ({ page }) => {
    const email = testEmail("invited")
    const link = await emailLinkPath("invite", email) // creates the invited auth user, sends nothing
    const { data } = await admin().auth.admin.listUsers({ page: 1, perPage: 1000 })
    const user = data.users.find((u) => u.email === email)!
    await admin().auth.admin.updateUserById(user.id, { app_metadata: { role: "intern" } })
    const ins = await admin().from("profiles").insert({ id: user.id, email, full_name: "E2E Invited", role: "intern", status: "invited" })
    if (ins.error) throw new Error(ins.error.message)

    await page.goto(link)
    await page.getByRole("button", { name: "Accept invitation" }).click()
    await expect(page).toHaveURL(/\/auth\/set-password/)
    await page.locator("#password").fill(PASSWORD)
    await page.locator("#confirm").fill(PASSWORD)
    await page.getByRole("button", { name: "Save and continue" }).click()
    await expect(page).toHaveURL(/\/intern/)
    const p = await admin().from("profiles").select("status").eq("id", user.id).single()
    expect(p.data?.status).toBe("active")
  })
})

test.describe.serial("submission → upload → review queue @writes", () => {
  let intern = { id: "", email: "" }
  let adminEmail = ""
  let ws = { clientId: "", campaignId: "" }
  const title = `E2E article ${Date.now()}`

  test.beforeAll(async () => {
    ws = await createWorkspace("submissions")
    intern = await createActiveUser("intern", "intern-sub", { campaignIds: [ws.campaignId] })
    adminEmail = (await createActiveUser("super_admin", "admin-sub")).email
  })

  async function fillSubmission(page: import("@playwright/test").Page, contentTitle: string) {
    await page.goto("/intern/submissions/new")
    // A choice made before React hydrates is reset by the form library, so repeat until the type's
    // description (rendered only by the hydrated form) appears and the campaign choice has stuck.
    await expect(async () => {
      await page.locator("#campaign_id").selectOption(ws.campaignId)
      await page.locator("#backlink_type_id").selectOption({ label: "Guest Posting" })
      await expect(page.getByText("Original article placed on a relevant third-party site")).toBeVisible({ timeout: 1_000 })
      await expect(page.locator("#campaign_id")).toHaveValue(ws.campaignId, { timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    await page.locator("#proposed_website").fill("https://publisher.example.org")
    await page.locator("#placement_url").fill("https://publisher.example.org/write-for-us")
    await page.locator("#target_url").fill("https://client.example.com/target")
    await page.locator("#anchor_text").fill("e2e anchor")
    await page.locator("#content_title").fill(contentTitle)
    await page.locator("#content_draft").fill("Draft body written by the end-to-end test.")
  }

  test("an intern saves a draft and lands on its page", async ({ page }) => {
    await signIn(page, intern.email)
    await fillSubmission(page, title)
    await page.getByRole("button", { name: "Save draft" }).click()
    await expect(page).toHaveURL(/\/intern\/submissions\/[0-9a-f-]{36}$/)
    await expect(page.getByText("Draft").first()).toBeVisible()
  })

  test("the intern uploads a supporting file; an oversized file is refused before sending", async ({ page }) => {
    await signIn(page, intern.email)
    const sub = await admin().from("backlink_submissions").select("id").eq("content_title", title).single()
    await page.goto(`/intern/submissions/${sub.data!.id}`)
    // Choose files the way a user does: the "Upload files" button opens the file picker only once
    // the page is interactive (setting the hidden input directly can race React's hydration).
    const choose = async (file: { name: string; mimeType: string; buffer: Buffer }) => {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload files" }).click()])
      await chooser.setFiles(file)
    }
    await choose({ name: "evidence.txt", mimeType: "text/plain", buffer: Buffer.from("e2e evidence") })
    await expect(page.getByText("File uploaded")).toBeVisible()
    await expect(page.getByText("evidence.txt")).toBeVisible()

    await choose({ name: "too-big.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })
    await expect(page.getByText("too-big.pdf: larger than 10 MB")).toBeVisible()
    const files = await admin().from("submission_files").select("file_name").eq("submission_id", sub.data!.id)
    expect(files.data?.map((f) => f.file_name)).toEqual(["evidence.txt"])
  })

  test("submitting for review moves it to Submitted and the Super Admin sees it", async ({ page, browser }) => {
    await signIn(page, intern.email)
    const reviewTitle = `${title} (submitted)`
    await fillSubmission(page, reviewTitle)
    await page.getByRole("button", { name: /Submit for review/ }).click()
    await expect(page).toHaveURL(/\/intern\/submissions\/[0-9a-f-]{36}$/)
    await expect(page.getByText("Submitted").first()).toBeVisible()

    const adminPage = await (await browser.newContext()).newPage()
    await signIn(adminPage, adminEmail)
    await adminPage.goto("/admin/submissions")
    await expect(adminPage.getByText(reviewTitle).first()).toBeVisible()
  })
})

test.describe.serial("password reset @writes", () => {
  let user = { id: "", email: "" }
  const NEW_PASSWORD = "E2e-New-Password-2026"
  test.beforeAll(async () => {
    const ws = await createWorkspace("reset")
    user = await createActiveUser("intern", "reset", { campaignIds: [ws.campaignId] })
  })

  test("the reset form always answers the same way (needs SMTP for the email itself)", async ({ page }) => {
    const since = Date.now()
    await page.goto("/forgot-password")
    await page.locator("#email").fill(user.email)
    await page.getByRole("button", { name: "Send reset link" }).click()
    await expect(page.getByText("If an account exists for that email, a reset link is on its way.")).toBeVisible()
    // With staging SMTP the email is really handed over; without it Supabase refuses outside addresses.
    if (SMTP) await expect.poll(async () => sentSince((await authUser(user.email))?.recovery_sent_at, since)).toBe(true)
  })

  test("the recovery link lets the user choose a new password and sign in with it", async ({ page, browser }) => {
    await page.goto(await emailLinkPath("recovery", user.email))
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible()
    await page.getByRole("button", { name: "Continue" }).click()
    await expect(page).toHaveURL(/\/auth\/set-password/)
    await page.locator("#password").fill(NEW_PASSWORD)
    await page.locator("#confirm").fill(NEW_PASSWORD)
    await page.getByRole("button", { name: "Save and continue" }).click()
    await expect(page).toHaveURL(/\/intern/)

    const fresh = await (await browser.newContext()).newPage()
    await signIn(fresh, user.email, NEW_PASSWORD)
    await expect(fresh).toHaveURL(/\/intern/)
  })
})

test.describe("role isolation in the browser @writes", () => {
  test("a client user reaches only the portal", async ({ page }) => {
    const ws = await createWorkspace("isolation")
    const client = await createActiveUser("client", "client-iso", { clientId: ws.clientId })
    await signIn(page, client.email)
    await expect(page).toHaveURL(/\/portal/)
    for (const path of ["/admin", "/admin/users", "/intern"]) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/portal/)
    }
  })
})
