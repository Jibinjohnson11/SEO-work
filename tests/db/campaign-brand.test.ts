import { beforeAll, describe, expect, it } from "vitest"
import { asUser, createDb, createUser, type Db } from "./harness"

// Migration 22 (20261023000022_campaign_brand_immutable.sql): a campaign's brand cannot change.

let db: Db
const ids: Record<string, string> = {}
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]

beforeAll(async () => {
  db = await createDb()
  ids.admin = await createUser(db, "super_admin", "Brand Admin")
  await asUser(db, ids.admin)
  ids.first = (await one<{ id: string }>("insert into clients (company_name) values ('First brand') returning id")).id
  ids.second = (await one<{ id: string }>("insert into clients (company_name) values ('Second brand') returning id")).id
  ids.campaign = (await one<{ id: string }>("insert into campaigns (name, client_id) values ('Campaign', $1) returning id", [ids.first])).id
}, 60_000)

describe("campaign brand", () => {
  it("cannot be moved to another brand, even by a Super Admin", async () => {
    await asUser(db, ids.admin)
    await expect(db.query("update campaigns set client_id = $1 where id = $2", [ids.second, ids.campaign])).rejects.toThrow(/brand cannot be changed/)
    expect(await one("select client_id from campaigns where id = $1", [ids.campaign])).toEqual({ client_id: ids.first })
  })

  it("still allows other edits, including writing the same brand back", async () => {
    await asUser(db, ids.admin)
    await db.query("update campaigns set name = 'Renamed', client_id = $1 where id = $2", [ids.first, ids.campaign])
    expect(await one("select name, client_id from campaigns where id = $1", [ids.campaign])).toEqual({ name: "Renamed", client_id: ids.first })
  })
})
