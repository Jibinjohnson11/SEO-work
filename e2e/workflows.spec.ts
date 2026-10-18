import { expect, test, type Page } from "@playwright/test"
import { admin, assertStagingTarget, createActiveUser, createWorkspace, RUN, signInOnce, userClient, writesConfigured } from "./support/target"

// @writes: the agency workflow end to end, on STAGING only (assertStagingTarget refuses production).
//   clients & campaigns (admin UI) → client decisions (portal UI) → notifications → publication &
//   live-link verification → reports & exports → daily job. Each stage uses the previous stage's data.
//
// Verification fetches real public pages: IANA's static "example domains" page (robots.txt allows all)
// links to /domains/reserved, and example.com contains no links at all. Each run adds ?e2e=<run> to
// the published URL because a placement (published URL + target) can be recorded only once.

test.skip(!writesConfigured(), "write tests run only against staging (set E2E_TARGET=staging)")
test.beforeAll(async ({ playwright }, info) => {
  const ctx = await playwright.request.newContext({ baseURL: info.project.use.baseURL })
  await assertStagingTarget(ctx)
  await ctx.dispose()
})

const TARGET = "https://www.iana.org/domains/reserved"
const LIVE_PAGE = `https://www.iana.org/help/example-domains?e2e=${RUN}`
const NO_LINK_PAGE = `https://example.com/?e2e=${RUN}`
/** A real page with plenty of links, none of them to TARGET. */
const MISSING_PAGE = `https://www.iana.org/about?e2e=${RUN}`
const DRIFT_PAGE = `https://www.iana.org/help/example-domains?e2e=${RUN}&case=drift`
/** The link text IANA's page actually uses for /domains/reserved. */
const REAL_ANCHOR = "IANA-managed Reserved Domains"

test.describe.serial("agency workflow @writes", () => {
  const ctx = {
    adminEmail: "", intern: { id: "", email: "" }, client: { id: "", email: "" },
    clientId: "", clientName: `E2E Workflow Client ${RUN}`, campaignId: "", campaignCode: "", typeId: "",
    subs: {} as Record<"approve" | "changes" | "reject" | "noLink" | "missing" | "drift", { id: string; code: string; title: string }>,
    otherCampaignCode: "",
  }

  test.beforeAll(async () => {
    ctx.adminEmail = (await createActiveUser("super_admin", "admin-wf")).email
    ctx.intern = await createActiveUser("intern", "intern-wf")
    const t = await admin().from("backlink_types").select("id").eq("slug", "guest-posting").single()
    ctx.typeId = t.data!.id
    // A second, unrelated workspace: its data must never appear in the first client's report.
    const other = await createWorkspace("other-tenant")
    ctx.otherCampaignCode = (await admin().from("campaigns").select("code").eq("id", other.campaignId).single()).data!.code
  })

  const switchIn = (page: Page, name: string) => page.getByRole("dialog").getByRole("switch", { name })
  async function setSwitch(page: Page, name: string, on: boolean) {
    const s = switchIn(page, name)
    if ((await s.isChecked()) !== on) await s.click()
    await expect(s).toBeChecked({ checked: on })
  }

  // ---- 1. clients and campaigns ----------------------------------------------------------------
  test("the Super Admin creates a client (client approval on, internal review off)", async ({ page }) => {
    await signInOnce(page, ctx.adminEmail)
    await page.goto("/admin/clients")
    await page.getByRole("button", { name: "New client" }).click()
    await page.locator("#company_name").fill(ctx.clientName)
    await page.locator("#website_url").fill("https://www.iana.org")
    await setSwitch(page, "Internal review required", false)
    await setSwitch(page, "Client approval required", true)
    await page.getByRole("button", { name: "Create client" }).click()
    await expect(page).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/)
    ctx.clientId = page.url().split("/").pop()!
    await expect(page.getByRole("heading", { name: ctx.clientName })).toBeVisible()
    const c = await admin().from("clients").select("company_name, require_internal_review, require_client_approval").eq("id", ctx.clientId).single()
    expect(c.data).toEqual({ company_name: ctx.clientName, require_internal_review: false, require_client_approval: true })
  })

  test("the Super Admin edits the client", async ({ page }) => {
    await signInOnce(page, ctx.adminEmail)
    await page.goto(`/admin/clients/${ctx.clientId}`)
    await page.getByRole("button", { name: "Edit", exact: true }).first().click()
    await page.locator("#industry").fill(`Reserved domains ${RUN}`)
    await page.locator("#contact_person").fill("E2E Contact")
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByRole("dialog")).toBeHidden()
    const c = await admin().from("clients").select("industry, contact_person").eq("id", ctx.clientId).single()
    expect(c.data).toEqual({ industry: `Reserved domains ${RUN}`, contact_person: "E2E Contact" })
  })

  test("the Super Admin creates a campaign for that client and edits it", async ({ page }) => {
    await signInOnce(page, ctx.adminEmail)
    await page.goto("/admin/campaigns")
    await page.getByRole("button", { name: "New campaign" }).click()
    await page.locator("#name").fill(`E2E Workflow Campaign ${RUN}`)
    await page.locator("#client_id").selectOption(ctx.clientId)
    await page.locator("#target_url").fill(TARGET)
    await page.locator("#status").selectOption("active")
    await page.getByRole("button", { name: "Create campaign" }).click()
    await expect(page).toHaveURL(/\/admin\/campaigns\/[0-9a-f-]{36}$/)
    ctx.campaignId = page.url().split("/").pop()!
    const created = await admin().from("campaigns").select("code, client_id, status, target_url").eq("id", ctx.campaignId).single()
    expect(created.data).toMatchObject({ client_id: ctx.clientId, status: "active", target_url: TARGET })
    ctx.campaignCode = created.data!.code

    await page.getByRole("button", { name: "Edit", exact: true }).first().click()
    await page.locator("#monthly_target").fill("12")
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByRole("dialog")).toBeHidden()
    const edited = await admin().from("campaigns").select("monthly_target").eq("id", ctx.campaignId).single()
    expect(edited.data?.monthly_target).toBe(12)

    // People for the next stages: an intern on the campaign and a reviewer in the client workspace.
    const a = await admin().from("intern_assignments").insert({ campaign_id: ctx.campaignId, intern_id: ctx.intern.id })
    if (a.error) throw new Error(a.error.message)
    ctx.client = await createActiveUser("client", "client-wf", { clientId: ctx.clientId })
  })

  // ---- 2. client decisions -------------------------------------------------------------------
  test("submissions on this campaign go straight to the client (internal review is off)", async () => {
    const intern = await userClient(ctx.intern.email)
    for (const key of ["approve", "changes", "reject", "noLink", "missing", "drift"] as const) {
      const title = `E2E ${key} ${RUN}`
      // "drift" deliberately records anchor text that differs from the live page's link text.
      const anchor = key === "drift" ? "reserved domains" : REAL_ANCHOR
      const r = await intern.rpc("submission_save", {
        p_id: null, p_submit: true,
        p_data: { campaign_id: ctx.campaignId, backlink_type_id: ctx.typeId, proposed_website: "https://www.iana.org", placement_url: "https://www.iana.org/help",
                  target_url: TARGET, anchor_text: anchor, content_title: title, content_draft: "Body written by the end-to-end test." },
      })
      if (r.error) throw new Error(`submission_save: ${r.error.message}`)
      const s = await admin().from("backlink_submissions").select("id, code, status").eq("id", r.data).single()
      expect(s.data?.status).toBe("awaiting_client_approval")
      ctx.subs[key] = { id: s.data!.id, code: s.data!.code, title }
    }
  })

  test("the client sees the items in their approval queue", async ({ page }) => {
    await signInOnce(page, ctx.client.email)
    await page.goto("/portal/approvals")
    for (const key of ["approve", "changes", "reject"] as const) await expect(page.getByText(ctx.subs[key].title).first()).toBeVisible()
  })

  test("the client approves one version", async ({ page }) => {
    await signInOnce(page, ctx.client.email)
    await page.goto(`/portal/approvals/${ctx.subs.approve.id}`)
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    await page.locator("#approve-note").fill("Looks good")
    await page.getByRole("button", { name: "Approve version 1" }).click()
    await expect(page.getByText("Thank you — your decision was recorded")).toBeVisible()
    expect((await admin().from("backlink_submissions").select("status").eq("id", ctx.subs.approve.id).single()).data?.status).toBe("client_approved")
  })

  test("the client requests changes (a reason is required)", async ({ page }) => {
    await signInOnce(page, ctx.client.email)
    await page.goto(`/portal/approvals/${ctx.subs.changes.id}`)
    await page.getByRole("button", { name: "Request changes" }).click()
    const send = page.getByRole("button", { name: "Request changes" })
    await expect(send).toBeDisabled() // empty reason
    await page.locator("#feedback").fill("Please add a source for the second claim.")
    await send.click()
    await expect(page.getByText("Thank you — your decision was recorded")).toBeVisible()
    expect((await admin().from("backlink_submissions").select("status").eq("id", ctx.subs.changes.id).single()).data?.status).toBe("client_changes_requested")
    const a = await admin().from("client_approvals").select("decision, feedback").eq("submission_id", ctx.subs.changes.id).single()
    expect(a.data).toEqual({ decision: "changes_requested", feedback: "Please add a source for the second claim." })
  })

  test("the client rejects one (a reason is required)", async ({ page }) => {
    await signInOnce(page, ctx.client.email)
    await page.goto(`/portal/approvals/${ctx.subs.reject.id}`)
    await page.getByRole("button", { name: "Reject" }).click()
    const send = page.getByRole("button", { name: "Reject" })
    await expect(send).toBeDisabled()
    await page.locator("#feedback").fill("Not relevant to our audience.")
    await send.click()
    await expect(page.getByText("Thank you — your decision was recorded")).toBeVisible()
    expect((await admin().from("backlink_submissions").select("status").eq("id", ctx.subs.reject.id).single()).data?.status).toBe("client_rejected")
  })

  // ---- 3. notifications ------------------------------------------------------------------------
  test("the intern is notified of each client decision and can mark them read", async ({ page }) => {
    await signInOnce(page, ctx.intern.email)
    await expect(page.getByRole("button", { name: /^Notifications, \d+ unread$/ })).toBeVisible()
    await page.goto("/intern/notifications")
    await expect(page.getByText(`${ctx.subs.approve.code} approved by client`)).toBeVisible()
    await expect(page.getByText(`Client requested changes on ${ctx.subs.changes.code}`)).toBeVisible()
    await expect(page.getByText(`${ctx.subs.reject.code} rejected by client`)).toBeVisible()
    await page.getByRole("button", { name: "Mark all read" }).click()
    await expect(page.getByText("All caught up")).toBeVisible()
    await page.reload()
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible()
    const unread = await admin().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ctx.intern.id).is("read_at", null)
    expect(unread.count).toBe(0)
  })

  test("a client user cannot record decisions on another client's work (database-enforced)", async () => {
    const other = await createWorkspace("decision-isolation")
    const outsider = await createActiveUser("client", "client-outsider", { clientId: other.clientId })
    const c = await userClient(outsider.email)
    const r = await c.rpc("submission_client_decision", { p_id: ctx.subs.noLink.id, p_decision: "approved", p_feedback: "", p_version: 1 })
    expect(r.error).not.toBeNull()
    expect((await admin().from("backlink_submissions").select("status").eq("id", ctx.subs.noLink.id).single()).data?.status).toBe("awaiting_client_approval")
  })

  // ---- 4. publication and verification -----------------------------------------------------------
  test("the intern records the publication of the approved backlink", async ({ page }) => {
    await signInOnce(page, ctx.intern.email)
    await page.goto(`/intern/submissions/${ctx.subs.approve.id}`)
    await page.locator("#published_url").fill(LIVE_PAGE)
    await page.getByRole("button", { name: "Record publication" }).click()
    await expect(page.getByText("Publication recorded — verification pending")).toBeVisible()
    expect((await admin().from("backlink_submissions").select("status").eq("id", ctx.subs.approve.id).single()).data?.status).toBe("verification_pending")
  })

  test("the Super Admin verifies it: the target link is found on the live page", async ({ page }) => {
    await signInOnce(page, ctx.adminEmail)
    await page.goto(`/admin/submissions/${ctx.subs.approve.id}`)
    await page.getByRole("button", { name: "Verify now" }).click()
    await expect(page.getByText("Verification finished")).toBeVisible({ timeout: 60_000 })
    const pb = await admin().from("published_backlinks").select("live_status").eq("submission_id", ctx.subs.approve.id).single()
    expect(pb.data?.live_status).toBe("live")
    expect((await admin().from("backlink_submissions").select("status").eq("id", ctx.subs.approve.id).single()).data?.status).toBe("verified_live")
  })

  /** Client approves, intern records the publication (both as the real users), then the admin verifies in the UI. */
  async function publishAndVerify(page: Page, key: "noLink" | "missing", publishedUrl: string) {
    const client = await userClient(ctx.client.email)
    const d = await client.rpc("submission_client_decision", { p_id: ctx.subs[key].id, p_decision: "approved", p_feedback: "", p_version: 1 })
    if (d.error) throw new Error(d.error.message)
    const intern = await userClient(ctx.intern.email)
    const p = await intern.rpc("submission_record_publication", { p_id: ctx.subs[key].id, p_published_url: publishedUrl, p_publication_date: new Date().toISOString().slice(0, 10), p_link_attribute: "dofollow", p_anchor_text: null })
    if (p.error) throw new Error(p.error.message)
    await signInOnce(page, ctx.adminEmail)
    await page.goto(`/admin/submissions/${ctx.subs[key].id}`)
    await page.getByRole("button", { name: "Verify now" }).click()
    await expect(page.getByText("Verification finished")).toBeVisible({ timeout: 60_000 })
    const pb = await admin().from("published_backlinks").select("id, live_status").eq("submission_id", ctx.subs[key].id).single()
    const check = await admin().from("verification_checks").select("result, link_found, error").eq("published_backlink_id", pb.data!.id).order("checked_at", { ascending: false }).limit(1).single()
    const status = (await admin().from("backlink_submissions").select("status").eq("id", ctx.subs[key].id).single()).data?.status
    return { liveStatus: pb.data?.live_status, check: check.data, status }
  }

  test("a page with links but not the target link is reported as missing (verification failed)", async ({ page }) => {
    const r = await publishAndVerify(page, "missing", MISSING_PAGE)
    expect(r.check).toMatchObject({ result: "missing", link_found: false })
    expect(r.liveStatus).toBe("missing")
    expect(r.status).toBe("verification_failed")
  })

  test("a page exposing no links (possibly script-rendered) is inconclusive: left for a manual check, never live", async ({ page }) => {
    const r = await publishAndVerify(page, "noLink", NO_LINK_PAGE)
    expect(r.check).toMatchObject({ result: "inconclusive", link_found: false })
    expect(r.check?.error).toMatch(/verify manually/)
    expect(r.liveStatus).toBe("pending_verification")
    expect(r.status).toBe("verification_pending")
  })

  test("anchor-text drift is flagged as 'changed' while the link still counts as live", async ({ page }) => {
    const client = await userClient(ctx.client.email)
    const d = await client.rpc("submission_client_decision", { p_id: ctx.subs.drift.id, p_decision: "approved", p_feedback: "", p_version: 1 })
    if (d.error) throw new Error(d.error.message)
    const intern = await userClient(ctx.intern.email)
    const p = await intern.rpc("submission_record_publication", { p_id: ctx.subs.drift.id, p_published_url: DRIFT_PAGE, p_publication_date: new Date().toISOString().slice(0, 10), p_link_attribute: "dofollow", p_anchor_text: "reserved domains" })
    if (p.error) throw new Error(p.error.message)

    await signInOnce(page, ctx.adminEmail)
    await page.goto(`/admin/submissions/${ctx.subs.drift.id}`)
    await page.getByRole("button", { name: "Verify now" }).click()
    await expect(page.getByText("Verification finished")).toBeVisible({ timeout: 60_000 })
    const pb = await admin().from("published_backlinks").select("id, live_status").eq("submission_id", ctx.subs.drift.id).single()
    expect(pb.data?.live_status).toBe("changed")
    expect((await admin().from("backlink_submissions").select("status").eq("id", ctx.subs.drift.id).single()).data?.status).toBe("verified_live")
    const check = await admin().from("verification_checks").select("link_found, error").eq("published_backlink_id", pb.data!.id).order("checked_at", { ascending: false }).limit(1).single()
    expect(check.data?.link_found).toBe(true)
    expect(check.data?.error).toContain(REAL_ANCHOR)
  })

  test("the same placement cannot be recorded twice", async () => {
    const intern = await userClient(ctx.intern.email)
    const r = await intern.rpc("submission_record_publication", { p_id: ctx.subs.approve.id, p_published_url: LIVE_PAGE, p_publication_date: new Date().toISOString().slice(0, 10), p_link_attribute: "dofollow", p_anchor_text: null })
    expect(r.error).not.toBeNull()
  })

  // ---- 5. reports, filtering and exports -------------------------------------------------------
  test("the daily report filtered to the client shows its campaign and only its campaign", async ({ page }) => {
    await signInOnce(page, ctx.adminEmail)
    await page.goto(`/admin/reports/daily?client=${ctx.clientId}`)
    // Assert on the report table (the Campaign filter dropdown lists the code too, as a hidden <option>).
    const table = page.getByRole("table", { name: "Report by Campaign" })
    await expect(table.getByRole("cell", { name: ctx.campaignCode, exact: true })).toBeVisible()
    await expect(table.getByText(ctx.otherCampaignCode)).toHaveCount(0)
    await expect(page.getByRole("option", { name: new RegExp(ctx.otherCampaignCode) })).toHaveCount(0)
  })

  test("report exports download as CSV, Excel and PDF with the filtered data", async ({ page }) => {
    await signInOnce(page, ctx.adminEmail)
    await page.goto(`/admin/reports/daily?client=${ctx.clientId}`)
    await page.getByRole("button", { name: "Export" }).click()
    const hrefs: Record<string, string> = {}
    for (const label of ["Excel (.xlsx)", "CSV", "PDF"]) hrefs[label] = (await page.getByRole("menuitem", { name: label }).getAttribute("href"))!
    await page.keyboard.press("Escape")
    for (const href of Object.values(hrefs)) expect(href).toContain(`client=${ctx.clientId}`)

    const csv = await page.request.get(hrefs.CSV)
    expect(csv.status()).toBe(200)
    expect(csv.headers()["content-type"]).toContain("text/csv")
    const text = await csv.text()
    expect(text).toContain(ctx.campaignCode)
    expect(text).not.toContain(ctx.otherCampaignCode)
    const xlsx = await page.request.get(hrefs["Excel (.xlsx)"])
    expect(xlsx.status()).toBe(200)
    expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK") // zip container
    const pdf = await page.request.get(hrefs.PDF)
    expect(pdf.status()).toBe(200)
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF")
  })

  test("submission and campaign exports include this run's records", async ({ page }) => {
    await signInOnce(page, ctx.adminEmail)
    const subs = await page.request.get("/api/submissions/export")
    expect(subs.status()).toBe(200)
    const subsCsv = await subs.text()
    for (const s of Object.values(ctx.subs)) expect(subsCsv).toContain(s.code)
    const camps = await page.request.get("/api/campaigns/export")
    expect(camps.status()).toBe(200)
    expect(await camps.text()).toContain(ctx.campaignCode)
  })

  test("exports are refused to non-admins", async ({ page }) => {
    await signInOnce(page, ctx.intern.email)
    for (const path of ["/api/reports/export?kind=daily&format=csv", "/api/submissions/export", "/api/campaigns/export", "/api/analytics/interns?format=csv"])
      expect((await page.request.get(path)).status(), path).toBe(403)
  })

  // ---- 6. the daily job ------------------------------------------------------------------------
  test("the daily job refuses a signed-in admin session without the secret", async ({ page }) => {
    await signInOnce(page, ctx.adminEmail)
    expect((await page.request.get("/api/cron/daily")).status()).toBe(401)
  })

  test("the daily job runs successfully with the secret, and again (idempotent)", async ({ request }) => {
    test.setTimeout(600_000)
    const secret = process.env.CRON_SECRET ?? ""
    expect(secret.length).toBeGreaterThanOrEqual(32)
    for (const run of [1, 2]) {
      const r = await request.get("/api/cron/daily", { headers: { Authorization: `Bearer ${secret}` }, timeout: 330_000 })
      const body = await r.json()
      expect(r.status(), `run ${run}: ${JSON.stringify(body.errors ?? body)}`).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.errors).toEqual([])
      expect(body).toHaveProperty("deadline_reminders")
      expect(body).toHaveProperty("verification")
      expect(typeof body.rate_limits_purged).toBe("number")
      expect(body.notification_email).toBeUndefined() // email digests are off by default
    }
    // Email delivery is off, so notifications stay un-emailed.
    const emailed = await admin().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ctx.intern.id).not("emailed_at", "is", null)
    expect(emailed.count).toBe(0)
  })
})
