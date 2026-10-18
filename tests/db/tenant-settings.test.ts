import { beforeAll, describe, expect, it } from "vitest"
import { asService, asSystem, asUser, createDb, createUser, type Db } from "./harness"

// campaign_flags() and client_portal_settings() are SECURITY DEFINER helpers that any signed-in
// user could call (regression: before 20261016000015_tenant_scoped_settings.sql they returned the
// workflow flags / portal settings of ANY campaign or client whose id the caller knew).

let db: Db
const ids: Record<string, string> = {}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0]
}
const settings = async (clientId: string) =>
  (await one<{ s: Record<string, unknown> | null }>("select client_portal_settings($1) as s", [clientId])).s
const flags = async (campaignId: string) => (await db.query("select * from campaign_flags($1)", [campaignId])).rows

beforeAll(async () => {
  db = await createDb()
  ids.admin = await createUser(db, "super_admin", "Owner Admin")
  ids.intern = await createUser(db, "intern", "Assigned Intern")
  ids.otherIntern = await createUser(db, "intern", "Unassigned Intern")
  ids.clientUserA = await createUser(db, "client", "Client A User")
  ids.clientUserB = await createUser(db, "client", "Client B User")

  await asUser(db, ids.admin)
  ids.clientA = (await one<{ id: string }>("insert into clients (company_name, is_medical) values ('Tenant A', true) returning id")).id
  ids.clientB = (await one<{ id: string }>(
    `insert into clients (company_name, portal_settings) values ('Tenant B', '{"show_intern_names": true}') returning id`,
  )).id
  await db.query("insert into client_members (client_id, user_id) values ($1, $2), ($3, $4)", [ids.clientA, ids.clientUserA, ids.clientB, ids.clientUserB])
  ids.campaignA = (await one<{ id: string }>("insert into campaigns (name, client_id, status, target_url) values ('A1', $1, 'active', 'https://a.example.com') returning id", [ids.clientA])).id
  ids.campaignB = (await one<{ id: string }>("insert into campaigns (name, client_id, status) values ('B1', $1, 'active') returning id", [ids.clientB])).id
  await db.query("insert into intern_assignments (campaign_id, intern_id) values ($1, $2)", [ids.campaignA, ids.intern])
})

describe("own tenant: access is unchanged", () => {
  it("the Super Admin sees every client's settings and every campaign's flags", async () => {
    await asUser(db, ids.admin)
    expect(await settings(ids.clientA)).toMatchObject({ show_reports: true })
    expect(await settings(ids.clientB)).toMatchObject({ show_intern_names: true })
    expect(await flags(ids.campaignA)).toHaveLength(1)
    expect(await flags(ids.campaignB)).toHaveLength(1)
  })

  it("a client user sees their own workspace's settings and campaign flags", async () => {
    await asUser(db, ids.clientUserA)
    expect(await settings(ids.clientA)).toMatchObject({ show_reports: true })
    expect(await flags(ids.campaignA)).toEqual([expect.objectContaining({ is_medical: true })])
  })

  it("an intern sees the settings and flags of a campaign assigned to them", async () => {
    await asUser(db, ids.intern)
    expect(await settings(ids.clientA)).not.toBeNull()
    expect(await flags(ids.campaignA)).toHaveLength(1)
  })

  it("the service role (daily job) sees everything", async () => {
    await asService(db)
    expect(await settings(ids.clientB)).not.toBeNull()
    expect(await flags(ids.campaignB)).toHaveLength(1)
  })
})

describe("another tenant: nothing is returned", () => {
  it("a client user cannot read another client's portal settings or campaign flags", async () => {
    await asUser(db, ids.clientUserA)
    expect(await settings(ids.clientB)).toBeNull()
    expect(await flags(ids.campaignB)).toEqual([])
  })

  it("an intern cannot read settings or flags of a client/campaign they are not assigned to", async () => {
    await asUser(db, ids.intern)
    expect(await settings(ids.clientB)).toBeNull()
    expect(await flags(ids.campaignB)).toEqual([])
    await asUser(db, ids.otherIntern)
    expect(await settings(ids.clientA)).toBeNull()
    expect(await flags(ids.campaignA)).toEqual([])
  })

  it("accounts without an active role get nothing", async () => {
    const pending = await createUser(db, "intern", "Disabled Intern", "disabled")
    await asUser(db, pending)
    expect(await settings(ids.clientA)).toBeNull()
    expect(await flags(ids.campaignA)).toEqual([])
  })
})

describe("workflow paths that use these helpers keep working", () => {
  it("an intern keeps access to a campaign they have work in after being unassigned", async () => {
    await asUser(db, ids.admin)
    const typeId = (await one<{ id: string }>("select id from backlink_types where slug = 'guest-posting'")).id
    await asUser(db, ids.intern)
    const sub = await one<{ id: string }>("select submission_save(null, $1, false) as id", [
      JSON.stringify({
        campaign_id: ids.campaignA, backlink_type_id: typeId, proposed_website: "https://blog.example.org",
        target_url: "https://a.example.com/page", anchor_text: "anchor", content_title: "Title", content_draft: "Draft",
      }),
    ])
    expect(sub.id).toBeTruthy()
    await asUser(db, ids.admin)
    await db.query("update intern_assignments set is_active = false where intern_id = $1 and campaign_id = $2", [ids.intern, ids.campaignA])
    await asUser(db, ids.intern)
    expect(await flags(ids.campaignA)).toHaveLength(1)
    expect(await settings(ids.clientA)).not.toBeNull()
  })

  it("the client portal still applies its own visibility settings", async () => {
    await asUser(db, ids.clientUserB)
    const clients = (await db.query<{ settings: Record<string, unknown> }>("select * from client_portal_clients()")).rows
    expect(clients).toHaveLength(1)
    expect(clients[0].settings).toMatchObject({ show_intern_names: true })
  })

  it("anonymous visitors cannot call either helper", async () => {
    await asSystem(db)
    await db.exec("set role anon")
    await expect(db.query("select client_portal_settings($1)", [ids.clientA])).rejects.toThrow(/permission denied/)
    await asSystem(db)
    await db.exec("set role anon")
    await expect(db.query("select * from campaign_flags($1)", [ids.campaignA])).rejects.toThrow(/permission denied/)
  })
})
