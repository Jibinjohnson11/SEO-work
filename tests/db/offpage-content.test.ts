import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { asSystem, asUser, createDb, createUser, type Db } from "./harness"

// Off-Page Content (migration 19): submit → client approval (the only stage) → changes / resubmit,
// with append-only history. Internal review switch-off (migration 20) and its rollback.

let db: Db
const ids: Record<string, string> = {}
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const data = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ campaign_id: ids.campaign, keyword_id: ids.keyword, backlink_type_id: ids.type, content_type: "blog", title: "CRM guide", content_html: "<p>v1</p>", ...over })
const submit = async (id: string | null, over: Record<string, unknown> = {}) =>
  (await one<{ id: string }>("select offpage_content_submit($1, $2::jsonb) as id", [id, data(over)])).id
const decide = (id: string, decision: string, feedback: string | null, version: number) =>
  db.query("select offpage_content_client_decision($1, $2, $3, $4)", [id, decision, feedback, version])

beforeAll(async () => {
  db = await createDb()
  ids.admin = await createUser(db, "super_admin", "Owner Admin")
  ids.intern = await createUser(db, "intern", "Team Member")
  ids.other = await createUser(db, "intern", "Other Member")
  ids.client = await createUser(db, "client", "Client Approver")
  await asUser(db, ids.admin)
  ids.brand = (await one<{ id: string }>("insert into clients (company_name) values ('Acme') returning id")).id
  ids.medical = (await one<{ id: string }>("insert into clients (company_name, is_medical) values ('Clinic', true) returning id")).id
  ids.campaign = (await one<{ id: string }>("insert into campaigns (name, client_id, status) values ('C1', $1, 'active') returning id", [ids.brand])).id
  ids.type = (await one<{ id: string }>("select id from backlink_types limit 1")).id
  ids.keyword = (await one<{ id: string }>("insert into keywords (keyword, client_id) values ('crm software', $1) returning id", [ids.brand])).id
  ids.stray = (await one<{ id: string }>("insert into keywords (keyword, client_id) values ('not on campaign', $1) returning id", [ids.brand])).id
  await db.query("insert into campaign_keywords (campaign_id, keyword_id, is_primary) values ($1, $2, true)", [ids.campaign, ids.keyword])
  await db.query("insert into intern_assignments (campaign_id, intern_id) values ($1, $2)", [ids.campaign, ids.intern])
  await db.query("insert into client_members (client_id, user_id, can_approve) values ($1, $2, true)", [ids.brand, ids.client])
})

describe("off-page content approval", () => {
  it("a team member submits straight to the client approval queue", async () => {
    await asUser(db, ids.intern)
    ids.content = await submit(null)
    const row = await one("select client_id, submitted_by, status, current_version from offpage_contents where id = $1", [ids.content])
    expect(row).toMatchObject({ client_id: ids.brand, submitted_by: ids.intern, status: "awaiting_client_approval", current_version: 1 })
    await asSystem(db)
    expect((await one<{ n: number }>("select count(*)::int as n from notifications where user_id = $1 and type = 'content_approval_requested'", [ids.client])).n).toBe(1)
    expect((await one<{ n: number }>("select count(*)::int as n from backlink_submissions")).n).toBe(0)
  })

  it("enforces campaign assignment, keyword and ownership", async () => {
    await asUser(db, ids.intern)
    await expect(submit(null, { keyword_id: ids.stray })).rejects.toThrow(/not one of this campaign's keywords/)
    await asUser(db, ids.other)
    await expect(submit(null)).rejects.toThrow(/not assigned to this campaign/)
    await expect(submit(ids.content)).rejects.toThrow(/Content not found|not assigned/)
    expect((await db.query("select id from offpage_contents")).rows).toHaveLength(0)
    await expect(db.query("insert into offpage_contents (campaign_id, keyword_id, backlink_type_id, content_type, title, content_html) values ($1, $2, $3, 'blog', 't', 'x')", [ids.campaign, ids.keyword, ids.type])).rejects.toThrow(/permission denied/)
  })

  it("changes required returns it to the author; resubmitting creates version 2", async () => {
    await asUser(db, ids.client)
    await expect(decide(ids.content, "changes_requested", null, 1)).rejects.toThrow(/explain the reason/)
    await decide(ids.content, "changes_requested", "Add a pricing section", 1)
    await asUser(db, ids.intern)
    expect((await one("select status from offpage_contents where id = $1", [ids.content])).status).toBe("changes_requested")
    await submit(ids.content, { content_html: "<p>v2</p>" })
    await asUser(db, ids.client)
    await expect(decide(ids.content, "approved", null, 1)).rejects.toThrow(/review version 2/)
    await decide(ids.content, "approved", null, 2)
    await asUser(db, ids.intern)
    expect(await one("select status, current_version, approved_version from offpage_contents where id = $1", [ids.content])).toEqual({ status: "approved", current_version: 2, approved_version: 2 })
    await expect(submit(ids.content, { content_html: "<p>v3</p>" })).rejects.toThrow(/can no longer be changed/)
  })

  it("keeps every version and decision, append-only", async () => {
    await asUser(db, ids.intern)
    expect((await db.query("select version from offpage_content_versions where content_id = $1 order by version", [ids.content])).rows).toEqual([{ version: 1 }, { version: 2 }])
    expect((await db.query("select version, decision from offpage_content_decisions where content_id = $1 order by created_at", [ids.content])).rows)
      .toEqual([{ version: 1, decision: "changes_requested" }, { version: 2, decision: "approved" }])
    await asSystem(db)
    await expect(db.query("delete from offpage_content_decisions")).rejects.toThrow(/append-only/)
  })
})

describe("client approval only (migration 20)", () => {
  it("switched internal review off for non-medical brands only, and the rollback restores it", async () => {
    const fresh = await createDb("20261021000020")
    await asSystem(fresh)
    const brand = (await fresh.query<{ id: string }>("insert into clients (company_name) values ('A') returning id")).rows[0].id
    const clinic = (await fresh.query<{ id: string }>("insert into clients (company_name, is_medical) values ('M', true) returning id")).rows[0].id
    const medCampaign = (await fresh.query<{ id: string }>("insert into campaigns (name, client_id, is_medical) values ('Med', $1, true) returning id", [brand])).rows[0].id
    const dir = join(__dirname, "..", "..", "supabase")
    await fresh.exec(readFileSync(join(dir, "migrations", "20261021000020_client_approval_only.sql"), "utf8"))
    const flags = async () => (await fresh.query("select (select require_internal_review from clients where id = $1) as brand, (select require_internal_review from clients where id = $2) as clinic, (select require_internal_review from campaigns where id = $3) as med_campaign", [brand, clinic, medCampaign])).rows[0]
    expect(await flags()).toEqual({ brand: false, clinic: true, med_campaign: true })
    await fresh.exec(readFileSync(join(dir, "rollbacks", "20261021000020_client_approval_only.rollback.sql"), "utf8"))
    expect(await flags()).toEqual({ brand: true, clinic: true, med_campaign: null })
    await fresh.close()
  }, 60_000)
})
