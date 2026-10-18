import { expect, test, type Browser, type Page } from "@playwright/test"
import { assertTokenBelongsTo, collectLinkManually, withTokenRedacted, type EmailLink } from "./support/email-links"
import { admin, assertStagingTarget, authUser, createActiveUser, createWorkspace, emailLinkPath, PASSWORD, RUN, signIn, testEmail, writesConfigured } from "./support/target"

// @writes: onboarding of Supabase Auth accounts that have no LinkOps profile (e.g. invited from the
// Supabase dashboard). STAGING only, with disposable @resend.dev accounts created by the test:
//   * E2E_ONBOARDING=1      creates those disposable accounts (approve before enabling);
//   * E2E_SMTP_CONFIGURED=1 also needed for the steps where LinkOps sends the invitation or
//                           password-setup email (Supabase Auth → Resend SMTP).
// The one-time links used to finish onboarding come from the Admin API (generateLink), which
// sends nothing. Existing staging users are never touched.

const ONBOARDING = process.env.E2E_ONBOARDING === "1"
const SMTP = process.env.E2E_SMTP_CONFIGURED === "1"
// Real emailed links: the person running the test copies each link from the Resend dashboard.
const EMAIL_LINKS = process.env.E2E_EMAIL_LINKS === "1"
test.skip(!writesConfigured(), "write tests run only against staging (set E2E_TARGET=staging)")
test.skip(!ONBOARDING, "creates disposable staging accounts; set E2E_ONBOARDING=1 once approved")
// Every test here opens one-time sign-in links (generated or emailed). Traces, screenshots and videos
// would record those tokenised URLs, so none are kept for this file.
test.use({ trace: "off", screenshot: "off", video: "off" })

test.beforeAll(async ({ playwright }, info) => {
  const ctx = await playwright.request.newContext({ baseURL: info.project.use.baseURL })
  await assertStagingTarget(ctx)
  await ctx.dispose()
})

// ---- what this run created, and only that --------------------------------------------------------
// Every resource is recorded the moment it is created and removed in afterAll in foreign-key order:
// assignments → campaigns → clients → linked profiles/accounts → the disposable Super Admin (which
// the linked profiles reference as created_by). Before anything is deleted it is re-read and must
// still carry this run's id and have been created during this run, so a pre-existing record can
// never match. admin() refuses to work until assertStagingTarget() has passed (never production).
const RUN_STARTED = Date.now() - 60_000 // allows for clock skew between this machine and Supabase
const run = {
  accounts: [] as { id: string; email: string; label: string; kind: "linked" | "admin" }[],
  workspaces: [] as { clientId: string; campaignId: string }[],
  assignments: [] as { intern_id: string; campaign_id: string }[],
}
const thisRun = (createdAt: string | null | undefined) => Boolean(createdAt) && Date.parse(createdAt!) >= RUN_STARTED

function track(kind: "linked" | "admin", label: string, account: { id: string; email: string }) {
  if (account.email !== testEmail(label)) throw new Error(`refusing to track ${account.email}: not this run's address`)
  run.accounts.push({ ...account, label, kind })
}

/** An Auth account with no profile, as the Supabase dashboard would leave it. */
async function accountWithoutProfile(label: string, confirmed: boolean) {
  const email = testEmail(label)
  const r = await admin().auth.admin.createUser({ email, password: confirmed ? PASSWORD : undefined, email_confirm: confirmed })
  if (r.error) throw new Error(r.error.message)
  track("linked", label, { id: r.data.user.id, email })
  return { id: r.data.user.id, email }
}

async function trackedWorkspace(label: string) {
  const ws = await createWorkspace(label)
  run.workspaces.push(ws)
  return ws
}

async function trackedAssignment(internId: string, campaignId: string) {
  const r = await admin().from("intern_assignments").insert({ campaign_id: campaignId, intern_id: internId })
  if (r.error) throw new Error(`assign intern: ${r.error.message}`)
  run.assignments.push({ intern_id: internId, campaign_id: campaignId })
}

test.afterAll(async () => {
  test.setTimeout(180_000) // cleanup must finish even after a failed or timed-out test
  if (process.env.E2E_KEEP_DATA === "1") return console.log(`[onboarding cleanup] run ${RUN}: kept (E2E_KEEP_DATA=1)`)
  if (!run.accounts.length && !run.workspaces.length) return
  const problems: string[] = []
  const removed = { assignments: 0, campaigns: 0, clients: 0, profiles: 0, accounts: 0 }
  const db = admin()
  const ownAccountIds = new Set(run.accounts.map((a) => a.id))
  const ownCampaignIds = new Set(run.workspaces.map((w) => w.campaignId))

  // 1. Intern assignments: only pairs this run inserted, between this run's account and campaign.
  for (const a of run.assignments) {
    if (!ownAccountIds.has(a.intern_id) || !ownCampaignIds.has(a.campaign_id)) {
      problems.push(`assignment ${a.intern_id}/${a.campaign_id}: not both from this run, skipped`)
      continue
    }
    const r = await db.from("intern_assignments").delete().eq("intern_id", a.intern_id).eq("campaign_id", a.campaign_id).select("id")
    if (r.error) problems.push(`assignment ${a.campaign_id}: ${r.error.message}`)
    else removed.assignments += r.data.length
  }

  // 2–3. Campaigns, then their clients (a campaign references its client).
  for (const w of run.workspaces) {
    const c = await db.from("campaigns").select("name, created_at").eq("id", w.campaignId).maybeSingle()
    if (c.data && (!c.data.name.includes(RUN) || !thisRun(c.data.created_at))) problems.push(`campaign ${w.campaignId}: not this run's, skipped`)
    else if (c.data) {
      const r = await db.from("campaigns").delete().eq("id", w.campaignId).select("id")
      if (r.error) problems.push(`campaign ${w.campaignId}: ${r.error.message}`)
      else removed.campaigns += r.data.length
    }
    const cl = await db.from("clients").select("company_name, created_at").eq("id", w.clientId).maybeSingle()
    if (cl.data && (!cl.data.company_name.includes(RUN) || !thisRun(cl.data.created_at))) problems.push(`client ${w.clientId}: not this run's, skipped`)
    else if (cl.data) {
      const r = await db.from("clients").delete().eq("id", w.clientId).select("id")
      if (r.error) problems.push(`client ${w.clientId}: ${r.error.message}`)
      else removed.clients += r.data.length
    }
  }

  // 4–5. Linked accounts first, the Super Admin last (linked profiles reference it as created_by).
  const ordered = [...run.accounts.filter((a) => a.kind === "linked"), ...run.accounts.filter((a) => a.kind === "admin")]
  for (const a of ordered) {
    const u = await db.auth.admin.getUserById(a.id)
    if (u.error || !u.data.user) continue // already gone
    if (u.data.user.email !== a.email || a.email !== testEmail(a.label) || !thisRun(u.data.user.created_at)) {
      problems.push(`account ${a.id}: does not match this run's ${a.label} account, skipped`)
      continue
    }
    const p = await db.from("profiles").delete().eq("id", a.id).select("id")
    if (p.error) {
      problems.push(`${a.email}: profile kept (${p.error.message}), so the account was kept too`)
      continue
    }
    removed.profiles += p.data.length
    const d = await db.auth.admin.deleteUser(a.id)
    if (d.error) problems.push(`${a.email}: account kept (${d.error.message})`)
    else removed.accounts++
  }

  // Verify: nothing this run created may remain.
  const remaining: string[] = []
  for (const a of run.accounts) {
    if ((await db.auth.admin.getUserById(a.id)).data.user) remaining.push(`account ${a.email}`)
    if ((await db.from("profiles").select("id").eq("id", a.id)).data?.length) remaining.push(`profile ${a.email}`)
  }
  for (const w of run.workspaces) {
    if ((await db.from("campaigns").select("id").eq("id", w.campaignId)).data?.length) remaining.push(`campaign ${w.campaignId}`)
    if ((await db.from("clients").select("id").eq("id", w.clientId)).data?.length) remaining.push(`client ${w.clientId}`)
  }
  for (const a of run.assignments)
    if ((await db.from("intern_assignments").select("id").eq("intern_id", a.intern_id).eq("campaign_id", a.campaign_id)).data?.length) remaining.push(`assignment ${a.campaign_id}`)

  console.log(`[onboarding cleanup] run ${RUN}: removed ${JSON.stringify(removed)}`)
  if (problems.length || remaining.length) {
    const report = `[onboarding cleanup] run ${RUN} INCOMPLETE. Problems: ${problems.join("; ") || "none"}. Still present: ${remaining.join(", ") || "nothing"}`
    console.error(report)
    throw new Error(report)
  }
})

async function accountsFor(email: string) {
  const { data } = await admin().auth.admin.listUsers({ page: 1, perPage: 1000 })
  return data.users.filter((u) => u.email === email).length
}

/** Opens Invite intern and submits it. The page must already be signed in as the Super Admin. */
async function inviteIntern(page: Page, email: string) {
  await page.goto("/admin/interns")
  await page.getByRole("button", { name: "Invite intern" }).click()
  await page.locator("#full_name").fill("E2E Linked Account")
  await page.locator("#email").fill(email)
  await page.getByRole("button", { name: "Send invitation" }).click()
}

async function setPasswordFrom(page: Page, link: string, button: string, password = PASSWORD) {
  await page.goto(link)
  await page.getByRole("button", { name: button }).click()
  await expect(page).toHaveURL(/\/auth\/set-password/)
  await page.locator("#password").fill(password)
  await page.locator("#confirm").fill(password)
  await page.getByRole("button", { name: "Save and continue" }).click()
}

test.describe.serial("accounts without a profile @writes", () => {
  let adminEmail = ""
  test.beforeAll(async () => {
    const a = await createActiveUser("super_admin", "admin-onboard")
    track("admin", "admin-onboard", a)
    adminEmail = a.email
  })

  test("an account without a profile can sign in to nothing: signed out with a clear message", async ({ page }) => {
    const a = await accountWithoutProfile("noprofile-signin", true)
    await page.goto("/login")
    await page.locator("#email").fill(a.email)
    await page.locator("#password").fill(PASSWORD)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByText("Your account is not active. Contact your administrator.")).toBeVisible()
    for (const path of ["/admin", "/intern", "/portal"]) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
    }
  })

  test("the Super Admin sees accounts without a profile on Users & Access", async ({ page }) => {
    const a = await accountWithoutProfile("noprofile-listed", false)
    await signIn(page, adminEmail)
    await page.goto("/admin/users")
    await expect(page.getByText(/Sign-in accounts without a LinkOps profile \(\d+\)/)).toBeVisible()
    await expect(page.getByText(a.email)).toBeVisible()
  })

  test("inviting an unconfirmed account without a profile links the same account (needs SMTP)", async ({ page }) => {
    test.skip(!SMTP, "LinkOps sends the invitation; set E2E_SMTP_CONFIGURED=1")
    const a = await accountWithoutProfile("noprofile-invited", false)
    await signIn(page, adminEmail)
    await inviteIntern(page, a.email)
    await expect(page.getByText("Invitation sent to the existing sign-in account")).toBeVisible()
    const p = await admin().from("profiles").select("id, role, status, permissions").eq("email", a.email).single()
    expect(p.data).toEqual({ id: a.id, role: "intern", status: "invited", permissions: null })
    expect(await accountsFor(a.email)).toBe(1)
    expect((await authUser(a.email))?.app_metadata.role).toBe("intern")

    // Accept (link generated without sending), set a password: activated, lands on the intern area.
    const ws = await trackedWorkspace("onboarding")
    await trackedAssignment(a.id, ws.campaignId)
    await setPasswordFrom(page, await emailLinkPath("invite", a.email), "Accept invitation")
    await expect(page).toHaveURL(/\/intern/)
    expect((await admin().from("profiles").select("status").eq("id", a.id).single()).data?.status).toBe("active")
    for (const path of ["/admin", "/portal"]) {
      await page.goto(path)
      await expect(page).not.toHaveURL(new RegExp(`${path}(/|$)`))
    }
  })

  test("inviting a confirmed account without a profile links it and sends a password-setup link (needs SMTP)", async ({ page }) => {
    test.skip(!SMTP, "LinkOps sends the password-setup email; set E2E_SMTP_CONFIGURED=1")
    const a = await accountWithoutProfile("noprofile-confirmed", true)
    await signIn(page, adminEmail)
    await inviteIntern(page, a.email)
    await expect(page.getByText(/Account linked\. It was already confirmed/)).toBeVisible()
    expect((await admin().from("profiles").select("id, status").eq("email", a.email).single()).data).toEqual({ id: a.id, status: "invited" })
    expect(await accountsFor(a.email)).toBe(1)

    await page.context().clearCookies()
    // Supabase rejects reusing the current password, and this account was created with PASSWORD.
    const newPassword = "E2e-Linked-Recovery-2026"
    expect(newPassword).not.toBe(PASSWORD)
    await setPasswordFrom(page, await emailLinkPath("recovery", a.email), "Continue", newPassword)
    await expect(page).toHaveURL(/\/intern|\/access/)
    expect((await admin().from("profiles").select("status").eq("id", a.id).single()).data?.status).toBe("active")
  })

  test("inviting the same address twice never creates a second account or profile (needs SMTP)", async ({ page }) => {
    test.skip(!SMTP, "LinkOps sends the invitation; set E2E_SMTP_CONFIGURED=1")
    const a = await accountWithoutProfile("noprofile-twice", false)
    await signIn(page, adminEmail) // once: the second invitation reuses this session
    await inviteIntern(page, a.email)
    await expect(page.getByText("Invitation sent to the existing sign-in account")).toBeVisible()
    await page.keyboard.press("Escape")
    await inviteIntern(page, a.email)
    await expect(page.getByText("A user with this email already exists")).toBeVisible()
    expect(await accountsFor(a.email)).toBe(1)
    expect((await admin().from("profiles").select("id").eq("email", a.email)).data).toHaveLength(1)
  })
})

// ---- the REAL emailed links -----------------------------------------------------------------------
// Each test sends one email to a new run-scoped @resend.dev inbox, waits for the person running it
// to hand over the link (support/email-links.ts), and opens it only after its shape and a read-only
// ownership lookup prove the token belongs to this run's disposable account. Traces, screenshots and
// videos are off for this file (see the top); errors are redacted.
test.describe.serial("real emailed links @writes @email-links", () => {
  test.skip(!SMTP || !EMAIL_LINKS, "sends real emails and needs a person to copy the links; set E2E_SMTP_CONFIGURED=1 and E2E_EMAIL_LINKS=1")
  // How long each test waits for the person to hand over the link (default 10, at most 45 minutes,
  // which keeps the whole flow inside the token's 60-minute lifetime).
  const LINK_WAIT_MS = Math.min(Math.max(Number(process.env.E2E_LINK_WAIT_MINUTES) || 10, 1), 45) * 60_000

  let adminEmail = ""
  test.beforeAll(async () => {
    const a = await createActiveUser("super_admin", "admin-links")
    track("admin", "admin-links", a)
    adminEmail = a.email
  })

  /** A fresh browser with no session: opening a link here can only act as the link's own user. */
  async function freshPage(browser: Browser) {
    const ctx = await browser.newContext()
    return { page: await ctx.newPage(), close: () => ctx.close() }
  }

  /** Opens the link; the Continue page appears and the token is NOT used until its button is pressed. */
  async function openLink(page: Page, link: EmailLink, heading: string, button: string) {
    await withTokenRedacted(link.token, async () => {
      await page.goto(link.href)
      await expect(page.getByRole("heading", { name: heading }), "the Continue page should open").toBeVisible()
      await page.getByRole("button", { name: button }).click()
    })
  }

  async function expectSpent(browser: Browser, link: EmailLink, heading: string, button: string) {
    const fresh = await freshPage(browser)
    try {
      await openLink(fresh.page, link, heading, button)
      await withTokenRedacted(link.token, async () => {
        await expect(fresh.page.getByText("That link is invalid or has expired. Request a new one."), "a used link must be refused").toBeVisible()
        expect(new URL(fresh.page.url()).pathname).toBe("/login")
      })
    } finally {
      await fresh.close()
    }
  }

  test("an invitation accepted through the real emailed link activates the account (needs SMTP + manual link)", async ({ page, browser }) => {
    test.setTimeout(LINK_WAIT_MS + 3 * 60_000)
    const label = "link-invite"
    const email = testEmail(label)
    const password = "E2e-Invited-Link-2026"

    await signIn(page, adminEmail)
    await inviteIntern(page, email) // a new address: the normal create-and-invite path, one email
    await expect(page.getByText("Invitation sent", { exact: true })).toBeVisible()
    const profile = (await admin().from("profiles").select("id, role, status").eq("email", email).single()).data
    expect(profile).toMatchObject({ role: "intern", status: "invited" })
    track("linked", label, { id: profile!.id as string, email })

    const link = await collectLinkManually({ label, recipient: email, type: "invite", timeoutMs: LINK_WAIT_MS, verify: (l) => assertTokenBelongsTo(l, { id: profile!.id as string, email }) })
    await assertTokenBelongsTo(link, { id: profile!.id as string, email })

    const invitee = await freshPage(browser)
    try {
      await openLink(invitee.page, link, "Accept your invitation", "Accept invitation")
      await withTokenRedacted(link.token, async () => {
        await expect(invitee.page).toHaveURL(/\/auth\/set-password$/)
        await invitee.page.locator("#password").fill(password)
        await invitee.page.locator("#confirm").fill(password)
        await invitee.page.getByRole("button", { name: "Save and continue" }).click()
        await expect(invitee.page).toHaveURL(/\/intern(\/|$)/)
      })
    } finally {
      await invitee.close()
    }
    expect((await admin().from("profiles").select("status").eq("id", profile!.id).single()).data?.status).toBe("active")

    // The new password signs in and lands in the intern area; other areas stay closed.
    const again = await freshPage(browser)
    try {
      await signIn(again.page, email, password)
      await expect(again.page).toHaveURL(/\/intern(\/|$)/)
      for (const path of ["/admin", "/portal"]) {
        await again.page.goto(path)
        await expect(again.page).not.toHaveURL(new RegExp(`${path}(/|$)`))
      }
    } finally {
      await again.close()
    }

    await expectSpent(browser, link, "Accept your invitation", "Accept invitation")
  })

  test("a password reset through the real emailed recovery link replaces the password (needs SMTP + manual link)", async ({ page, browser }) => {
    test.setTimeout(LINK_WAIT_MS + 3 * 60_000)
    const label = "link-recovery"
    const user = await createActiveUser("intern", label) // active, with the shared test PASSWORD
    track("linked", label, user)
    const newPassword = "E2e-Recovered-Link-2026"
    expect(newPassword).not.toBe(PASSWORD)

    await page.goto("/forgot-password")
    await page.locator("#email").fill(user.email)
    await page.getByRole("button", { name: "Send reset link" }).click()
    await expect(page.getByText("If an account exists for that email, a reset link is on its way.")).toBeVisible()

    const link = await collectLinkManually({ label, recipient: user.email, type: "recovery", timeoutMs: LINK_WAIT_MS, verify: (l) => assertTokenBelongsTo(l, user) })
    await assertTokenBelongsTo(link, user)

    const owner = await freshPage(browser)
    try {
      await openLink(owner.page, link, "Reset your password", "Continue")
      await withTokenRedacted(link.token, async () => {
        await expect(owner.page).toHaveURL(/\/auth\/set-password$/)
        await owner.page.locator("#password").fill(newPassword)
        await owner.page.locator("#confirm").fill(newPassword)
        await owner.page.getByRole("button", { name: "Save and continue" }).click()
        await expect(owner.page).toHaveURL(/\/intern(\/|$)/)
      })
    } finally {
      await owner.close()
    }

    // New password works; the old one is refused.
    const fresh = await freshPage(browser)
    try {
      await signIn(fresh.page, user.email, newPassword)
      await expect(fresh.page).toHaveURL(/\/intern(\/|$)/)
    } finally {
      await fresh.close()
    }
    const old = await freshPage(browser)
    try {
      await old.page.goto("/login")
      await old.page.locator("#email").fill(user.email)
      await old.page.locator("#password").fill(PASSWORD)
      await old.page.getByRole("button", { name: "Sign in" }).click()
      await expect(old.page.getByText("Invalid email or password.")).toBeVisible()
      await expect(old.page).toHaveURL(/\/login/)
    } finally {
      await old.close()
    }

    await expectSpent(browser, link, "Reset your password", "Continue")
  })
})
