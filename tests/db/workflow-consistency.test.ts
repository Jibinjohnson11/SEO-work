import { beforeAll, describe, expect, it } from "vitest"
import { asSystem, asUser, createDb, createUser, type Db } from "./harness"

// Migration 21 (20261023000021_workflow_consistency.sql): medical review cannot be skipped, approved
// Off-Page Content linked to a submission replaces the placement's client approval, campaign status rules,
// the content admin override, the "no approver" alert, the portal brand, and campaign_sync_relations().

let db: Db
const ids: Record<string, string> = {}
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const status = async (id: string) => (await one<{ status: string }>("select status from backlink_submissions where id = $1", [id])).status

async function campaign(name: string, brand: string, campaignStatus = "active") {
  await asUser(db, ids.admin)
  const id = (await one<{ id: string }>("insert into campaigns (name, client_id, status) values ($1, $2, $3) returning id", [name, brand, campaignStatus])).id
  const kw = (await one<{ id: string }>("insert into keywords (keyword, client_id) values ($1, $2) returning id", [`${name} keyword`, brand])).id
  await db.query("insert into campaign_keywords (campaign_id, keyword_id, is_primary) values ($1, $2, true)", [id, kw])
  await db.query("insert into intern_assignments (campaign_id, intern_id) values ($1, $2)", [id, ids.intern])
  ids[`${name}:kw`] = kw
  return id
}

async function saveSubmission(campaignId: string, extra: Record<string, unknown> = {}, submit = true) {
  await asUser(db, ids.intern)
  const payload = {
    campaign_id: campaignId, backlink_type_id: ids.type, link_attribute: "dofollow",
    proposed_website: `https://publisher-${Math.random().toString(36).slice(2, 8)}.example.org`,
    placement_url: "https://publisher.example.org/write-for-us", target_url: "https://client.example.com/services",
    anchor_text: "software services", content_title: "Title", content_draft: "Draft body", website_relevance: "Tech audience",
    ...extra,
  }
  return (await one<{ id: string }>("select submission_save(null, $1, $2) as id", [JSON.stringify(payload), submit])).id
}

async function approvedContent(campaignId: string, keyword: string) {
  await asUser(db, ids.intern)
  const id = (await one<{ id: string }>("select offpage_content_submit(null, $1::jsonb) as id", [
    JSON.stringify({ campaign_id: campaignId, keyword_id: keyword, backlink_type_id: ids.type, content_type: "blog", title: "Guide", content_html: "<p>Body</p>" }),
  ])).id
  await asUser(db, ids.client)
  await db.query("select offpage_content_client_decision($1, 'approved', null, 1)", [id])
  return id
}

beforeAll(async () => {
  db = await createDb()
  ids.admin = await createUser(db, "super_admin", "Consistency Admin")
  ids.intern = await createUser(db, "intern", "Consistency Member")
  ids.client = await createUser(db, "client", "Consistency Approver")
  await asUser(db, ids.admin)
  ids.type = (await one<{ id: string }>("select id from backlink_types where slug = 'guest-posting'")).id
  // Brands as the UI now creates them: internal review off, medical or not.
  ids.brand = (await one<{ id: string }>("insert into clients (company_name, require_internal_review) values ('Plain', false) returning id")).id
  ids.clinic = (await one<{ id: string }>("insert into clients (company_name, is_medical, require_internal_review) values ('Clinic', true, false) returning id")).id
  ids.lonely = (await one<{ id: string }>("insert into clients (company_name, require_internal_review) values ('No approver', false) returning id")).id
  await db.query("insert into client_members (client_id, user_id, can_approve) values ($1, $2, true), ($3, $2, true)", [ids.brand, ids.client, ids.clinic])
  ids.plain = await campaign("Plain", ids.brand)
  ids.medical = await campaign("Medical", ids.clinic)
  ids.lonelyCampaign = await campaign("Lonely", ids.lonely)
}, 60_000)

describe("medical review", () => {
  it("is required for a medical brand even when its internal review setting is off", async () => {
    await asUser(db, ids.admin)
    expect(await one("select require_internal_review from campaign_flags($1)", [ids.medical])).toEqual({ require_internal_review: true })
    expect(await one("select require_internal_review from campaign_flags($1)", [ids.plain])).toEqual({ require_internal_review: false })
    const med = await saveSubmission(ids.medical)
    const plain = await saveSubmission(ids.plain)
    expect(await status(med)).toBe("submitted")
    expect(await status(plain)).toBe("awaiting_client_approval")
  })

  it("follows the medical_review_required setting", async () => {
    await asSystem(db)
    await db.query("update application_settings set value = jsonb_set(value, '{medical_review_required}', 'false') where key = 'approval'")
    await asUser(db, ids.admin)
    expect(await one("select require_internal_review from campaign_flags($1)", [ids.medical])).toEqual({ require_internal_review: false })
    await asSystem(db)
    await db.query("update application_settings set value = jsonb_set(value, '{medical_review_required}', 'true') where key = 'approval'")
  })
})

describe("approved Off-Page Content linked to a submission", () => {
  it("skips the placement's client approval and can be published", async () => {
    const content = await approvedContent(ids.plain, ids["Plain:kw"])
    const sub = await saveSubmission(ids.plain, { offpage_content_id: content })
    expect(await status(sub)).toBe("ready_for_publication")
    await asUser(db, ids.intern)
    await db.query("select submission_record_publication($1, 'https://publisher.example.org/p/linked', current_date, 'dofollow')", [sub])
    expect(await status(sub)).toBe("verification_pending")
    expect(await one("select approved_content_id from submission_flags($1)", [sub])).toEqual({ approved_content_id: content })
  })

  it("refuses content that is not approved, from another campaign, or already linked", async () => {
    const pending = (await one<{ id: string }>("select offpage_content_submit(null, $1::jsonb) as id", [
      JSON.stringify({ campaign_id: ids.plain, keyword_id: ids["Plain:kw"], backlink_type_id: ids.type, content_type: "blog", title: "Pending", content_html: "<p>x</p>" }),
    ])).id
    await expect(saveSubmission(ids.plain, { offpage_content_id: pending })).rejects.toThrow(/client-approved content of this campaign/)
    const other = await approvedContent(ids.medical, ids["Medical:kw"])
    await expect(saveSubmission(ids.plain, { offpage_content_id: other })).rejects.toThrow(/client-approved content of this campaign/)
    const used = await approvedContent(ids.plain, ids["Plain:kw"])
    await saveSubmission(ids.plain, { offpage_content_id: used }, false)
    await expect(saveSubmission(ids.plain, { offpage_content_id: used })).rejects.toThrow(/already linked/)
  })

  it("still sends a linked medical submission through internal review", async () => {
    const content = await approvedContent(ids.medical, ids["Medical:kw"])
    const sub = await saveSubmission(ids.medical, { offpage_content_id: content })
    expect(await status(sub)).toBe("submitted")
  })

  it("leaves unlinked submissions on the normal client approval path", async () => {
    const sub = await saveSubmission(ids.plain)
    expect(await status(sub)).toBe("awaiting_client_approval")
  })
})

describe("campaign status rules", () => {
  it("assigns tasks only for active campaigns", async () => {
    const draft = await campaign("Draft", ids.brand, "draft")
    await asUser(db, ids.admin)
    await expect(db.query("insert into tasks (title, intern_id, campaign_id, cadence, target_quantity) values ('t', $1, $2, 'one_off', 1)", [ids.intern, draft]))
      .rejects.toThrow(/active campaigns/)
    await db.query("insert into tasks (title, intern_id, campaign_id, cadence, target_quantity) values ('t', $1, $2, 'one_off', 1)", [ids.intern, ids.plain])
  })

  it("accepts content for active or draft campaigns only", async () => {
    const draft = await campaign("Draft2", ids.brand, "draft")
    const paused = await campaign("Paused", ids.brand, "paused")
    await asUser(db, ids.intern)
    const content = (c: string, kw: string) => db.query("select offpage_content_submit(null, $1::jsonb)", [
      JSON.stringify({ campaign_id: c, keyword_id: kw, backlink_type_id: ids.type, content_type: "blog", title: "T", content_html: "<p>x</p>" }),
    ])
    await content(draft, ids["Draft2:kw"])
    await expect(content(paused, ids["Paused:kw"])).rejects.toThrow(/active or draft campaigns/)
  })
})

describe("Off-Page Content: no approver, admin override, portal brand", () => {
  it("alerts the Super Admins when nobody at the brand can approve", async () => {
    await asUser(db, ids.intern)
    ids.lonelyContent = (await one<{ id: string }>("select offpage_content_submit(null, $1::jsonb) as id", [
      JSON.stringify({ campaign_id: ids.lonelyCampaign, keyword_id: ids["Lonely:kw"], backlink_type_id: ids.type, content_type: "blog", title: "Alone", content_html: "<p>x</p>" }),
    ])).id
    await asSystem(db)
    expect((await one<{ n: number }>("select count(*)::int as n from notifications where user_id = $1 and type = 'content_no_approver'", [ids.admin])).n).toBe(1)
  })

  it("lets a Super Admin override only when overrides are allowed, with a reason, recorded as an override", async () => {
    await asUser(db, ids.admin)
    await expect(db.query("select offpage_content_admin_decision($1, 'approved', 'client unreachable', 1)", [ids.lonelyContent])).rejects.toThrow(/disabled/)
    await asSystem(db)
    await db.query("update application_settings set value = jsonb_set(value, '{allow_admin_override}', 'true') where key = 'approval'")
    await asUser(db, ids.admin)
    await expect(db.query("select offpage_content_admin_decision($1, 'approved', ' ', 1)", [ids.lonelyContent])).rejects.toThrow(/reason is required/)
    await db.query("select offpage_content_admin_decision($1, 'approved', 'client unreachable', 1)", [ids.lonelyContent])
    expect(await one("select status, approved_version from offpage_contents where id = $1", [ids.lonelyContent])).toEqual({ status: "approved", approved_version: 1 })
    expect(await one("select is_admin_override, feedback from offpage_content_decisions where content_id = $1", [ids.lonelyContent]))
      .toEqual({ is_admin_override: true, feedback: "client unreachable" })
    await asUser(db, ids.intern)
    await expect(db.query("select offpage_content_admin_decision($1, 'approved', 'x', 1)", [ids.lonelyContent])).rejects.toThrow()
  })

  it("returns the brand on the portal detail", async () => {
    const content = await approvedContent(ids.plain, ids["Plain:kw"])
    await asUser(db, ids.client)
    const d = (await one<{ d: Record<string, unknown> }>("select client_portal_offpage_content($1) as d", [content])).d
    expect(d).toMatchObject({ client_id: ids.brand, brand: "Plain" })
  })
})

describe("campaign_sync_relations", () => {
  it("replaces keywords, primary, types and team atomically, Super Admin only", async () => {
    await asUser(db, ids.admin)
    const c = await campaign("Sync", ids.brand)
    await asUser(db, ids.admin)
    const k2 = (await one<{ id: string }>("insert into keywords (keyword, client_id) values ('second', $1) returning id", [ids.brand])).id
    await db.query("select campaign_sync_relations($1, $2, $3, $4, $5)", [c, [ids["Sync:kw"], k2], k2, [ids.type], []])
    expect((await db.query("select keyword_id, is_primary from campaign_keywords where campaign_id = $1 order by is_primary", [c])).rows)
      .toEqual([{ keyword_id: ids["Sync:kw"], is_primary: false }, { keyword_id: k2, is_primary: true }])
    expect((await db.query("select backlink_type_id from campaign_backlink_types where campaign_id = $1", [c])).rows).toEqual([{ backlink_type_id: ids.type }])
    expect(await one("select is_active from intern_assignments where campaign_id = $1 and intern_id = $2", [c, ids.intern])).toEqual({ is_active: false })
    // A failure part-way (keyword of another brand) changes nothing.
    const foreign = (await one<{ id: string }>("insert into keywords (keyword, client_id) values ('foreign', $1) returning id", [ids.clinic])).id
    await expect(db.query("select campaign_sync_relations($1, $2, $3, $4, $5)", [c, [foreign], foreign, [], [ids.intern]])).rejects.toThrow(/different clients/)
    expect((await db.query("select keyword_id from campaign_keywords where campaign_id = $1", [c])).rows).toHaveLength(2)
    await asUser(db, ids.intern)
    await expect(db.query("select campaign_sync_relations($1, $2, $3, $4, $5)", [c, [], null, [], []])).rejects.toThrow()
  })
})
