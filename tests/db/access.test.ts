import { beforeAll, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { FEATURES } from "@/lib/permissions"
import { asSystem, asUser, createDb, createUser, type Db } from "./harness"

// Self-registration, approval and feature-level permissions, enforced by the database.

let db: Db
const ids: Record<string, string> = {}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0]
}
async function fails(sql: string, params: unknown[], pattern: RegExp) {
  await expect(db.query(sql, params)).rejects.toThrow(pattern)
}
async function selfSignup(name: string) {
  const id = randomUUID()
  await asSystem(db)
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    `${name.toLowerCase()}@Example.test`,
    JSON.stringify({ full_name: `  ${name}  `, self_signup: true }),
  ])
  return id
}
const perms = async (userId: string) => {
  await asUser(db, userId)
  return (await one<{ p: string[] }>("select my_permissions() as p")).p
}

beforeAll(async () => {
  db = await createDb()
  ids.admin = await createUser(db, "super_admin", "Owner Admin")
  ids.intern = await createUser(db, "intern", "Existing Intern")
  ids.client = await createUser(db, "client", "Existing Client")
  await asUser(db, ids.admin)
  ids.clientA = (await one<{ id: string }>("insert into clients (company_name) values ('Acme') returning id")).id
  await db.query("insert into client_members (client_id, user_id) values ($1, $2)", [ids.clientA, ids.client])
  ids.campaign = (await one<{ id: string }>("insert into campaigns (name, client_id, status) values ('C1', $1, 'active') returning id", [ids.clientA])).id
})

describe("feature catalog", () => {
  it("role defaults in the migration match src/lib/permissions.ts", async () => {
    await asSystem(db)
    const rows = (await db.query<{ role: "intern" | "client"; features: string[] }>("select role, features from role_permissions")).rows
    for (const role of ["intern", "client"] as const)
      expect(rows.find((r) => r.role === role)?.features.sort()).toEqual(FEATURES[role].map((f) => f.key).sort())
  })

  it("existing users keep every feature of their role; Super Admin has all", async () => {
    expect(await perms(ids.admin)).toEqual(["*"])
    expect((await perms(ids.intern)).sort()).toEqual(FEATURES.intern.map((f) => f.key).sort())
    expect((await perms(ids.client)).sort()).toEqual(FEATURES.client.map((f) => f.key).sort())
  })
})

describe("self-registration", () => {
  it("creates a pending profile with no role, and notifies admins", async () => {
    ids.pending = await selfSignup("Newbie")
    const p = await one<{ role: string | null; status: string; email: string; full_name: string }>(
      "select role, status, email, full_name from profiles where id = $1",
      [ids.pending],
    )
    expect(p).toEqual({ role: null, status: "pending", email: "newbie@example.test", full_name: "Newbie" })
    const n = await one<{ c: number }>("select count(*)::int as c from notifications where user_id = $1 and type = 'registration.pending'", [ids.admin])
    expect(n.c).toBe(1)
  })

  it("auth users created any other way (invites) do not get a profile from the trigger", async () => {
    const id = randomUUID()
    await asSystem(db)
    await db.query("insert into auth.users (id, email) values ($1, 'invitee@example.test')", [id])
    expect(await one("select id from profiles where id = $1", [id])).toBeUndefined()
  })

  it("pending users have no permissions and no data access", async () => {
    expect(await perms(ids.pending)).toEqual([])
    await asUser(db, ids.pending)
    expect((await db.query("select id from campaigns")).rows).toEqual([])
    expect((await db.query("select id from clients")).rows).toEqual([])
    expect((await db.query("select key from application_settings")).rows).toEqual([])
    // They can read only their own profile row.
    expect((await db.query("select id from profiles")).rows).toEqual([{ id: ids.pending }])
    await fails("select * from client_portal_campaigns()", [], /Client access required/)
    await fails("select submission_save(null, '{}'::jsonb, false)", [], /does not have access/)
  })

  it("pending users cannot approve themselves or grant themselves features", async () => {
    await asUser(db, ids.pending)
    await fails("update profiles set status = 'active', role = 'intern' where id = $1", [ids.pending], /Only a Super Admin/)
    await fails("update profiles set permissions = '{intern.tasks}' where id = $1", [ids.pending], /Only a Super Admin/)
    await fails("select approve_registration($1, 'intern', null)", [ids.pending], /Only a Super Admin/)
  })

  it("other users cannot approve accounts", async () => {
    await asUser(db, ids.intern)
    await fails("select approve_registration($1, 'intern', null)", [ids.pending], /Only a Super Admin/)
    await fails("update profiles set permissions = '{intern.tasks,intern.campaigns}' where id = $1", [ids.intern], /Only a Super Admin/)
  })

  it("a profile cannot be active without a role", async () => {
    await asUser(db, ids.admin)
    await fails("update profiles set status = 'active' where id = $1", [ids.pending], /profiles_role_required/)
  })
})

describe("approval and feature permissions", () => {
  it("the Super Admin approves with an explicit feature list", async () => {
    await asUser(db, ids.admin)
    await db.query("select approve_registration($1, 'intern', $2, null, true, true, $3)", [ids.pending, ["intern.tasks"], [ids.campaign]])
    const p = await one<{ role: string; status: string; permissions: string[] }>("select role, status, permissions from profiles where id = $1", [ids.pending])
    expect(p).toEqual({ role: "intern", status: "active", permissions: ["intern.tasks"] })
    expect(await perms(ids.pending)).toEqual(["intern.tasks"])
    await asUser(db, ids.pending)
    expect((await db.query("select id from campaigns")).rows).toEqual([{ id: ids.campaign }])
  })

  it("an approved account cannot be approved again or have its role changed", async () => {
    await asUser(db, ids.admin)
    await fails("select approve_registration($1, 'client', null, $2)", [ids.pending, ids.clientA], /already been reviewed/)
    await fails("update profiles set role = 'client' where id = $1", [ids.pending], /assigned once/)
    await fails("update profiles set role = 'super_admin' where id = $1", [ids.pending], /database administrator/)
  })

  it("RPCs behind a feature reject users without it", async () => {
    await asUser(db, ids.pending)
    await fails("select submission_save(null, '{}'::jsonb, false)", [], /does not have access/)
    await fails("select submission_add_file($1, 'x', 'x', 'text/plain', 1)", [randomUUID()], /does not have access/)
    // intern.tasks is granted: the call reaches the task logic.
    await fails("select task_set_status($1, 'in_progress')", [randomUUID()], /Task not found/)
  })

  it("feature keys of another role are ignored", async () => {
    await asUser(db, ids.admin)
    await db.query("update profiles set permissions = '{intern.tasks,portal.reports}' where id = $1", [ids.pending])
    expect(await perms(ids.pending)).toEqual(["intern.tasks"])
  })

  it("revoking every feature leaves an approved user with nothing", async () => {
    await asUser(db, ids.admin)
    await db.query("update profiles set permissions = '{}' where id = $1", [ids.pending])
    expect(await perms(ids.pending)).toEqual([])
    await asUser(db, ids.pending)
    await fails("select task_set_status($1, 'in_progress')", [randomUUID()], /does not have access/)
  })

  it("users following role defaults pick up changes to the defaults", async () => {
    await asUser(db, ids.admin)
    await db.query("update role_permissions set features = '{portal.campaigns,portal.approvals}' where role = 'client'")
    expect((await perms(ids.client)).sort()).toEqual(["portal.approvals", "portal.campaigns"])
    await asUser(db, ids.client)
    expect((await db.query("select id from client_portal_campaigns()")).rows).toEqual([{ id: ids.campaign }])
    await fails("select * from client_portal_published()", [], /does not have access/)
    await fails("select submission_client_decision($1, 'approved', null, 1)", [randomUUID()], /does not have access/)
  })

  it("only the Super Admin can change role defaults", async () => {
    await asUser(db, ids.client)
    const r = await db.query("update role_permissions set features = '{portal.reports}' where role = 'client'")
    expect(r.affectedRows).toBe(0)
  })

  it("rejected registrations stay without access and can be approved later", async () => {
    ids.rejected = await selfSignup("Spammy")
    await asUser(db, ids.admin)
    await db.query("update profiles set status = 'rejected' where id = $1", [ids.rejected])
    expect(await perms(ids.rejected)).toEqual([])
    await asUser(db, ids.admin)
    await fails("select approve_registration($1, 'client', null)", [ids.rejected], /client workspace/)
    await db.query("select approve_registration($1, 'client', null, $2, false, false)", [ids.rejected, ids.clientA])
    const m = await one<{ can_approve: boolean }>("select can_approve from client_members where user_id = $1", [ids.rejected])
    expect(m.can_approve).toBe(false)
    // permissions = null -> role defaults (changed above)
    expect((await perms(ids.rejected)).sort()).toEqual(["portal.approvals", "portal.campaigns"])
  })
})
