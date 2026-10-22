import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { asSystem, asUser, createDb, createUser, type Db } from "./harness"

// Migration 16 lifecycle: fresh apply, rollback, reapply. The rollback deliberately keeps the two new
// columns, so the reapply must accept exactly those columns and refuse anything incompatible.

const SUPABASE = join(__dirname, "..", "..", "supabase")
const MIGRATION = readFileSync(join(SUPABASE, "migrations", "20261019000016_submission_versioning.sql"), "utf8")
const ROLLBACK = readFileSync(join(SUPABASE, "rollbacks", "20261019000016_submission_versioning.rollback.sql"), "utf8")
const inTransaction = (sql: string) => `begin;\n${sql}\ncommit;`

async function rows(d: Db, sql: string, params: unknown[] = []) {
  return (await d.query<Record<string, unknown>>(sql, params)).rows
}

/** Everything migration 16 or its rollback can touch: schema, function bodies and permissions, triggers, RLS. */
async function catalog(d: Db) {
  await asSystem(d)
  return {
    functions: await rows(d,
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, pg_get_functiondef(p.oid) as def,
         coalesce(p.proacl::text, '') as acl
       from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
    triggers: await rows(d, "select tgrelid::regclass::text || '.' || tgname as t, tgenabled from pg_trigger where not tgisinternal order by 1"),
    columns: await rows(d,
      `select attname, format_type(atttypid, atttypmod) as type, attnotnull, atthasdef from pg_attribute
       where attrelid = 'public.submission_versions'::regclass and attnum > 0 and not attisdropped order by attnum`),
    constraints: await rows(d,
      "select conname, pg_get_constraintdef(oid) as def, convalidated from pg_constraint where conrelid = 'public.submission_versions'::regclass order by 1"),
    policies: await rows(d,
      `select polrelid::regclass::text as tbl, polname, polcmd, pg_get_expr(polqual, polrelid) as qual from pg_policy
       where polrelid in ('public.submission_versions'::regclass, 'public.internal_reviews'::regclass, 'public.client_approvals'::regclass)
       order by 1, 2`),
    tableAcl: await rows(d,
      `select relname, relacl::text as acl, relrowsecurity from pg_class
       where oid in ('public.submission_versions'::regclass, 'public.internal_reviews'::regclass, 'public.client_approvals'::regclass) order by 1`),
  }
}

/** A hash of every row in the history tables (and the submissions), so any change to existing data shows. */
async function dataFingerprint(d: Db) {
  await asSystem(d)
  const out: Record<string, unknown> = {}
  for (const t of ["backlink_submissions", "submission_versions", "internal_reviews", "client_approvals", "submission_events", "activity_logs"]) {
    out[t] = (await rows(d, `select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x.id::text), '')) as h from public.${t} x`))[0]
  }
  return out
}

describe("migration 16: fresh apply, rollback and reapply", () => {
  let db: Db
  let fresh: Awaited<ReturnType<typeof catalog>>
  const ids: Record<string, string> = {}

  async function save(subId: string | null, data: Record<string, unknown>, submit = true) {
    await asUser(db, ids.intern)
    const payload = {
      campaign_id: ids.campaign, backlink_type_id: ids.type, keyword_id: ids.keyword, link_attribute: "dofollow",
      proposed_website: "https://publisher.example.org", placement_url: "https://publisher.example.org/write-for-us",
      target_url: "https://client.example.com/services", anchor_text: "software services", content_title: "Title",
      content_draft: "Draft body", website_relevance: "Tech audience", ...data,
    }
    return (await rows(db, "select submission_save($1, $2, $3) as id", [subId, JSON.stringify(payload), submit]))[0].id as string
  }
  async function requestChanges(subId: string) {
    await asUser(db, ids.admin)
    await db.query("select submission_start_review($1)", [subId])
    await db.query("select submission_internal_decision($1, 'changes_requested', 'Please improve')", [subId])
  }

  beforeAll(async () => {
    // Migration 16's own lifecycle, with nothing newer applied (later migrations are rolled back first).
    db = await createDb("20261019000017")
    fresh = await catalog(db)
    ids.admin = await createUser(db, "super_admin", "Lifecycle Admin")
    ids.intern = await createUser(db, "intern", "Lifecycle Intern")
    await asUser(db, ids.admin)
    ids.client = (await rows(db, "insert into clients (company_name, require_internal_review, require_client_approval) values ('Lifecycle Client', true, true) returning id"))[0].id as string
    ids.campaign = (await rows(db, "insert into campaigns (name, client_id, status) values ('Lifecycle', $1, 'active') returning id", [ids.client]))[0].id as string
    ids.keyword = (await rows(db, "insert into keywords (keyword, client_id) values ('lifecycle', $1) returning id", [ids.client]))[0].id as string
    await db.query("insert into campaign_keywords (campaign_id, keyword_id) values ($1, $2)", [ids.campaign, ids.keyword])
    await db.query(
      "insert into tasks (title, intern_id, campaign_id, cadence, target_quantity, due_date) values ('Lifecycle task', $1, $2, 'daily', 5, current_date + 5)",
      [ids.intern, ids.campaign],
    )
    ids.type = (await rows(db, "select id from backlink_types where slug = 'guest-posting'"))[0].id as string
    // History written while migration 16 is active: an initial and a minor version, with a review.
    ids.sub = await save(null, {})
    await requestChanges(ids.sub)
    await save(ids.sub, { website_relevance: "Stronger relevance" })
  }, 60_000)

  it("a fresh apply creates both columns with exactly the expected types and validated CHECK constraints", () => {
    expect(fresh.columns.filter((c) => ["change_type", "approval_carried_from"].includes(c.attname as string))).toEqual([
      { attname: "change_type", type: "text", attnotnull: false, atthasdef: false },
      { attname: "approval_carried_from", type: "integer", attnotnull: false, atthasdef: false },
    ])
    expect(fresh.constraints.filter((c) => (c.conname as string).match(/change_type|approval_carried_from/))).toEqual([
      { conname: "submission_versions_approval_carried_from_check", def: "CHECK ((approval_carried_from > 0))", convalidated: true },
      {
        conname: "submission_versions_change_type_check",
        def: "CHECK ((change_type = ANY (ARRAY['initial'::text, 'material'::text, 'minor'::text, 'unchanged'::text])))",
        convalidated: true,
      },
    ])
    expect(fresh.triggers.map((t) => t.t)).toEqual(
      expect.arrayContaining(["client_approvals.client_approvals_immutable", "internal_reviews.internal_reviews_immutable", "submission_versions.submission_versions_immutable"]),
    )
  })

  it("rollback then reapply returns exactly to the freshly applied state and preserves all existing data", async () => {
    await asSystem(db)
    expect((await rows(db, "select version, change_type from submission_versions where submission_id = $1 order by 1", [ids.sub])))
      .toEqual([{ version: 1, change_type: "initial" }, { version: 2, change_type: "minor" }])
    const dataBefore = await dataFingerprint(db)

    // Rollback: the pre-16 catalog except for the two kept columns; data untouched.
    await db.exec(inTransaction(ROLLBACK))
    const pre16 = await createDb("20261019000016") // every migration before 16
    const expectedRolledBack = await catalog(pre16)
    await pre16.close()
    const rolledBack = await catalog(db)
    expect(rolledBack.functions).toEqual(expectedRolledBack.functions)
    expect(rolledBack.triggers).toEqual(expectedRolledBack.triggers)
    expect(rolledBack.policies).toEqual(expectedRolledBack.policies)
    expect(rolledBack.tableAcl).toEqual(expectedRolledBack.tableAcl)
    expect(rolledBack.columns).toEqual(fresh.columns) // kept on purpose
    expect(rolledBack.constraints).toEqual(fresh.constraints)
    expect(await dataFingerprint(db)).toEqual(dataBefore)

    // Reapply: identical to the fresh apply, data still untouched.
    await db.exec(inTransaction(MIGRATION))
    expect(await catalog(db)).toEqual(fresh)
    expect(await dataFingerprint(db)).toEqual(dataBefore)

    // And it behaves: a minor resubmission versions again, history is append-only again, helpers stay closed.
    await requestChanges(ids.sub)
    await save(ids.sub, { notes: "after reapply" })
    await asSystem(db)
    expect((await rows(db, "select version, change_type from submission_versions where submission_id = $1 order by 1", [ids.sub])).at(-1))
      .toEqual({ version: 3, change_type: "minor" })
    await expect(db.query("update submission_versions set change_summary = 'x' where submission_id = $1", [ids.sub])).rejects.toThrow(/append-only/)
    const helpers = await rows(db,
      `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
       from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('_snapshot_submission', '_submission_snapshot', '_client_approval_covers_current', 'prevent_history_mutation', '_submission_material')
       order by 1`)
    expect(helpers.every((h) => h.auth === false && h.anon === false)).toBe(true)
    expect(helpers).toHaveLength(5)
  }, 60_000)
})

describe("migration 16 refuses incompatible existing columns", () => {
  let pre16: Db
  beforeAll(async () => {
    pre16 = await createDb("20261019000016")
  }, 60_000)

  it.each([
    ["wrong type", "add column change_type varchar(20) check (change_type in ('initial', 'material', 'minor', 'unchanged'))", /change_type exists but is not a nullable text column/],
    ["not null", "add column change_type text not null default 'initial' check (change_type in ('initial', 'material', 'minor', 'unchanged'))", /change_type exists but is not a nullable text column/],
    ["no constraint", "add column approval_carried_from integer", /approval_carried_from does not have exactly the expected constraint/],
    ["different constraint", "add column approval_carried_from integer constraint submission_versions_approval_carried_from_check check (approval_carried_from >= 0)", /approval_carried_from does not have exactly the expected constraint/],
    ["extra constraint", "add column change_type text constraint submission_versions_change_type_check check (change_type in ('initial', 'material', 'minor', 'unchanged')), add constraint extra_check check (change_type <> 'minor')", /change_type does not have exactly the expected constraint/],
    ["unvalidated constraint", "add column approval_carried_from integer, add constraint submission_versions_approval_carried_from_check check (approval_carried_from > 0) not valid", /approval_carried_from does not have exactly the expected constraint/],
  ])("%s → refused, and nothing is applied", async (_label, ddl, error) => {
    await asSystem(pre16)
    const before = await catalog(pre16)
    await pre16.exec("begin")
    await pre16.exec(`alter table public.submission_versions ${ddl}`)
    await expect(pre16.exec(MIGRATION)).rejects.toThrow(error)
    await pre16.exec("rollback")
    expect(await catalog(pre16)).toEqual(before)
  })
})
