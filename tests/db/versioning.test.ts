import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { asSystem, asUser, createDb, createUser, type Db } from "./harness"

// Submission versioning (20261019000016_submission_versioning.sql) against the real migrations:
// every resubmission after requested changes is a new version; material vs minor vs unchanged;
// stale client decisions; approval of the CURRENT version for publication (re-approval on and off);
// append-only history; legacy versions written before the migration.

let db: Db
const ids: Record<string, string> = {}

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows
}
async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await rows<T>(sql, params))[0]
}
async function fails(sql: string, params: unknown[], pattern: RegExp) {
  await expect(db.query(sql, params)).rejects.toThrow(pattern)
}

const article = {
  proposed_website: "https://publisher.example.org",
  placement_url: "https://publisher.example.org/write-for-us",
  target_url: "https://client.example.com/services",
  anchor_text: "software services",
  content_title: "Choosing a software partner",
  content_draft: "Draft body v1",
  website_relevance: "Tech audience",
  link_attribute: "dofollow",
}

type Version = { version: number; change_type: string | null; is_material_change: boolean; approval_carried_from: number | null; change_summary: string | null }
async function versions(subId: string) {
  await asSystem(db)
  return rows<Version>(
    "select version, change_type, is_material_change, approval_carried_from, change_summary from submission_versions where submission_id = $1 order by version",
    [subId],
  )
}
async function state(subId: string) {
  await asSystem(db)
  return one<{ status: string; current_version: number; client_approved_version: number | null }>(
    "select status, current_version, client_approved_version from backlink_submissions where id = $1",
    [subId],
  )
}

/** The intern saves (and optionally submits) a submission on the given campaign. */
async function save(subId: string | null, campaign: "R" | "N", data: Record<string, unknown>, submit = true) {
  await asUser(db, ids.intern)
  const payload = { campaign_id: ids[`campaign${campaign}`], backlink_type_id: ids.guestType, keyword_id: ids[`keyword${campaign}1`], ...article, ...data }
  return (await one<{ id: string }>("select submission_save($1, $2, $3) as id", [subId, JSON.stringify(payload), submit])).id
}
async function requestInternalChanges(subId: string, comment = "Please improve") {
  await asUser(db, ids.admin)
  await db.query("select submission_start_review($1)", [subId])
  await db.query("select submission_internal_decision($1, 'changes_requested', $2)", [subId, comment])
}
async function approveAndForward(subId: string) {
  await asUser(db, ids.admin)
  await db.query("select submission_start_review($1)", [subId])
  await db.query("select submission_internal_decision($1, 'approved', 'ok', '{}', null, true)", [subId])
}
async function clientDecides(campaign: "R" | "N", subId: string, decision: string, version: number, feedback: string | null = null) {
  await asUser(db, ids[`clientUser${campaign}`])
  await db.query("select submission_client_decision($1, $2, $3, $4)", [subId, decision, feedback, version])
}

beforeAll(async () => {
  db = await createDb()
  ids.admin = await createUser(db, "super_admin", "Versioning Admin")
  ids.intern = await createUser(db, "intern", "Versioning Intern")
  ids.clientUserR = await createUser(db, "client", "Reapproval Client")
  ids.clientUserN = await createUser(db, "client", "No Reapproval Client")

  await asUser(db, ids.admin)
  for (const [key, reapproval] of [["R", true], ["N", false]] as const) {
    ids[`client${key}`] = (
      await one<{ id: string }>(
        `insert into clients (company_name, require_internal_review, require_client_approval, reapproval_on_material_change)
         values ($1, true, true, $2) returning id`,
        [`Client ${key}`, reapproval],
      )
    ).id
    await db.query("insert into client_members (client_id, user_id, can_approve) values ($1, $2, true)", [ids[`client${key}`], ids[`clientUser${key}`]])
    ids[`campaign${key}`] = (
      await one<{ id: string }>("insert into campaigns (name, client_id, status) values ($1, $2, 'active') returning id", [`Campaign ${key}`, ids[`client${key}`]])
    ).id
    for (const n of [1, 2]) {
      ids[`keyword${key}${n}`] = (
        await one<{ id: string }>("insert into keywords (keyword, client_id) values ($1, $2) returning id", [`keyword ${key}${n}`, ids[`client${key}`]])
      ).id
      await db.query("insert into campaign_keywords (campaign_id, keyword_id) values ($1, $2)", [ids[`campaign${key}`], ids[`keyword${key}${n}`]])
    }
    // Creating a task assigns the intern to the campaign.
    await db.query(
      "insert into tasks (title, intern_id, campaign_id, cadence, target_quantity, due_date) values ($1, $2, $3, 'daily', 5, current_date + 5)",
      [`Task ${key}`, ids.intern, ids[`campaign${key}`]],
    )
  }
  ids.guestType = (await one<{ id: string }>("select id from backlink_types where slug = 'guest-posting'")).id
  ids.directoryType = (await one<{ id: string }>("select id from backlink_types where slug = 'business-directory'")).id
}, 60_000)

describe("versions on submission and resubmission after internal changes", () => {
  it("draft saves create no version; the first submission is v1 'initial'", async () => {
    ids.subA = await save(null, "R", {}, false)
    await save(ids.subA, "R", { content_draft: "edited draft" }, false)
    expect(await versions(ids.subA)).toEqual([])
    await save(ids.subA, "R", {})
    expect(await versions(ids.subA)).toEqual([{ version: 1, change_type: "initial", is_material_change: true, approval_carried_from: null, change_summary: null }])
    expect(await state(ids.subA)).toMatchObject({ status: "submitted", current_version: 1 })
  })

  it("a minor change (website relevance only) after requested changes is v2 'minor'; v1 is preserved exactly", async () => {
    await asSystem(db)
    const v1Before = await one("select * from submission_versions where submission_id = $1 and version = 1", [ids.subA])
    await requestInternalChanges(ids.subA)
    await save(ids.subA, "R", { website_relevance: "Strong tech audience, DR 60" })
    const v = await versions(ids.subA)
    expect(v.map((x) => [x.version, x.change_type, x.is_material_change])).toEqual([[1, "initial", true], [2, "minor", false]])
    await asSystem(db)
    expect(await one("select * from submission_versions where submission_id = $1 and version = 1", [ids.subA])).toEqual(v1Before)
    const snap = await one<{ s: Record<string, unknown> }>("select snapshot as s from submission_versions where submission_id = $1 and version = 2", [ids.subA])
    expect(snap.s.website_relevance).toBe("Strong tech audience, DR 60") // complete snapshot
  })

  it("review history, status events, activity and notifications reference the right version", async () => {
    await requestInternalChanges(ids.subA, "One more pass") // second review is on v2
    await asSystem(db)
    expect(await rows("select version, decision from internal_reviews where submission_id = $1 order by created_at", [ids.subA])).toEqual([
      { version: 1, decision: "changes_requested" },
      { version: 2, decision: "changes_requested" },
    ])
    const submittedEvents = await rows<{ version: number }>(
      "select version from submission_events where submission_id = $1 and to_status = 'submitted' order by occurred_at, id",
      [ids.subA],
    )
    expect(submittedEvents.map((e) => e.version)).toEqual([1, 2])
    const activity = await rows<{ summary: string; metadata: { version: number; change_type: string } }>(
      "select summary, metadata from activity_logs where action = 'submission.submitted' and entity_id = $1 order by created_at, id",
      [ids.subA],
    )
    expect(activity.map((a) => a.summary)).toEqual([expect.stringMatching(/submitted \(v1\)$/), expect.stringMatching(/submitted \(v2, minor revision\)$/)])
    expect(activity[1].metadata).toMatchObject({ version: 2, change_type: "minor" })
    // Admins are notified of the resubmission (the notification key includes the new version).
    const received = await rows<{ dedupe_key: string; body: string }>(
      "select dedupe_key, body from notifications where user_id = $1 and type = 'submission_received' and entity_id = $2 order by created_at",
      [ids.admin, ids.subA],
    )
    expect(received.map((n) => n.dedupe_key)).toEqual([`submitted:${ids.subA}:1`, `submitted:${ids.subA}:2`])
    expect(received[1].body).toMatch(/revision v2, minor revision/)
    // The intern is notified of the second review too (key includes v2).
    const decisions = await rows("select 1 from notifications where user_id = $1 and type = 'internal_changes_requested' and entity_id = $2", [ids.intern, ids.subA])
    expect(decisions).toHaveLength(2)
  })

  it("a material change is v3 'material'", async () => {
    await save(ids.subA, "R", { website_relevance: "Strong tech audience, DR 60", content_draft: "Draft body v3 with sources" })
    expect((await versions(ids.subA)).at(-1)).toMatchObject({ version: 3, change_type: "material", is_material_change: true })
  })

  it("an unchanged resubmission needs a change summary, then is v4 'unchanged'", async () => {
    await requestInternalChanges(ids.subA)
    const same = { website_relevance: "Strong tech audience, DR 60", content_draft: "Draft body v3 with sources" }
    await expect(save(ids.subA, "R", same)).rejects.toThrow(/Nothing changed since version 3.*change summary/)
    expect(await state(ids.subA)).toMatchObject({ status: "internal_changes_requested", current_version: 3 }) // nothing half-applied
    await save(ids.subA, "R", { ...same, change_summary: "Sources were already cited; see paragraph 2" })
    expect((await versions(ids.subA)).at(-1)).toMatchObject({
      version: 4, change_type: "unchanged", is_material_change: false, change_summary: "Sources were already cited; see paragraph 2",
    })
  })

  it.each([
    ["link_attribute", { link_attribute: "nofollow" }],
    ["keyword_id", { keyword_id: "@keywordR2" }],
    ["backlink_type_id", { backlink_type_id: "@directoryType" }],
  ])("changing %s alone is material", async (_field, change) => {
    const resolved = Object.fromEntries(Object.entries(change).map(([k, v]) => [k, typeof v === "string" && v.startsWith("@") ? ids[v.slice(1)] : v]))
    const sub = await save(null, "R", {})
    await requestInternalChanges(sub)
    await save(sub, "R", resolved)
    expect((await versions(sub)).map((v) => v.change_type)).toEqual(["initial", "material"])
  })
})

describe("client changes requested and stale client decisions", () => {
  it("a minor revision after client changes is a new version; deciding on the old version is refused", async () => {
    ids.subC = await save(null, "R", {})
    await approveAndForward(ids.subC)
    await clientDecides("R", ids.subC, "changes_requested", 1, "Mention our support team")
    expect(await state(ids.subC)).toMatchObject({ status: "client_changes_requested", current_version: 1 })
    await save(ids.subC, "R", { website_relevance: "Mentions support team in bio" })
    expect((await versions(ids.subC)).map((v) => v.change_type)).toEqual(["initial", "minor"])
    await approveAndForward(ids.subC)
    await expect(clientDecides("R", ids.subC, "approved", 1)).rejects.toThrow(/content changed while you were reviewing/)
    await clientDecides("R", ids.subC, "approved", 2)
    await asSystem(db)
    expect(await rows("select version, decision from client_approvals where submission_id = $1 order by created_at", [ids.subC])).toEqual([
      { version: 1, decision: "changes_requested" },
      { version: 2, decision: "approved" },
    ])
    expect(await state(ids.subC)).toMatchObject({ status: "client_approved", current_version: 2, client_approved_version: 2 })
  })
})

describe("publication requires approval of the current version", () => {
  async function approvedSubmission(campaign: "R" | "N") {
    const sub = await save(null, campaign, {})
    await approveAndForward(sub)
    await clientDecides(campaign, sub, "approved", 1)
    return sub
  }
  async function adminEdit(sub: string, data: Record<string, unknown>, summary: string) {
    await asUser(db, ids.admin)
    await db.query("select submission_admin_edit($1, $2, $3)", [sub, JSON.stringify({ ...article, ...data }), summary])
  }
  async function publish(sub: string) {
    await asUser(db, ids.intern)
    return db.query("select submission_record_publication($1, $2, current_date, 'dofollow')", [sub, `https://publisher.example.org/p/${sub}`])
  }

  it("a notes-only admin edit after approval keeps the version and the approval", async () => {
    const sub = await approvedSubmission("R")
    await adminEdit(sub, { notes: "internal note" }, "notes")
    expect(await state(sub)).toMatchObject({ status: "client_approved", current_version: 1, client_approved_version: 1 })
    await asUser(db, ids.admin)
    await db.query("select submission_mark_ready($1)", [sub])
    await publish(sub)
    expect((await state(sub)).status).toBe("verification_pending")
  })

  it("re-approval ON: a material edit after approval needs the client to approve the new version", async () => {
    const sub = await approvedSubmission("R")
    await adminEdit(sub, { anchor_text: "custom software services" }, "tightened anchor")
    expect(await state(sub)).toMatchObject({ status: "awaiting_client_approval", current_version: 2, client_approved_version: 1 })
    expect((await versions(sub)).at(-1)).toMatchObject({ version: 2, change_type: "material", approval_carried_from: null })
    await asUser(db, ids.admin)
    await fails("select submission_mark_ready($1)", [sub], /required approvals/)
    await expect(publish(sub)).rejects.toThrow(/Only approved submissions/)
    await expect(clientDecides("R", sub, "approved", 1)).rejects.toThrow(/content changed/) // v1's approval is not reusable
    await clientDecides("R", sub, "approved", 2)
    await asUser(db, ids.admin)
    await db.query("select submission_mark_ready($1)", [sub])
    await publish(sub)
    expect(await state(sub)).toMatchObject({ status: "verification_pending", current_version: 2, client_approved_version: 2 })
  })

  it("re-approval OFF: the new version explicitly carries the earlier approval forward, and only then may it be published", async () => {
    const sub = await approvedSubmission("N")
    await adminEdit(sub, { anchor_text: "custom software services" }, "tightened anchor")
    expect(await state(sub)).toMatchObject({ status: "client_approved", current_version: 2, client_approved_version: 1 })
    expect((await versions(sub)).at(-1)).toMatchObject({ version: 2, change_type: "material", approval_carried_from: 1 })
    await asSystem(db)
    const act = await one<{ summary: string }>(
      "select summary from activity_logs where action = 'submission.admin_edited' and entity_id = $1",
      [sub],
    )
    expect(act.summary).toMatch(/\(v2\); client approval of v1 carried forward \(re-approval not required by campaign setting\)/)
    await asUser(db, ids.admin)
    await db.query("select submission_mark_ready($1)", [sub])
    await publish(sub)
    expect((await state(sub)).status).toBe("verification_pending")
  })

  it("an older approval is never silently reused: without a carry-forward record, or once re-approval is required, publication is refused", async () => {
    const sub = await approvedSubmission("N")
    await adminEdit(sub, { anchor_text: "bespoke software" }, "edit")
    // The campaign now requires re-approval: the carried-forward approval no longer counts.
    await asUser(db, ids.admin)
    expect((await db.query("update clients set reapproval_on_material_change = true where id = $1", [ids.clientN])).affectedRows).toBe(1)
    await fails("select submission_mark_ready($1)", [sub], /current content version \(v2\) has no client approval/)
    await expect(publish(sub)).rejects.toThrow(/current content version \(v2\) has no recorded approval/)
    await asUser(db, ids.admin) // publish() acted as the intern, whose update RLS would silently skip
    expect((await db.query("update clients set reapproval_on_material_change = false where id = $1", [ids.clientN])).affectedRows).toBe(1)

    // A version with a newer number but no carry-forward record (forged directly in the table) does not count either.
    const other = await approvedSubmission("N")
    await asSystem(db)
    await db.query(
      `insert into submission_versions (submission_id, version, snapshot, content_hash, change_type)
       select id, 2, '{}'::jsonb, 'x', 'material' from backlink_submissions where id = $1`,
      [other],
    )
    await db.query("update backlink_submissions set current_version = 2 where id = $1", [other])
    await asUser(db, ids.admin)
    await fails("select submission_mark_ready($1)", [other], /has no client approval/)
  })
})

describe("append-only history", () => {
  it.each(["submission_versions", "internal_reviews", "client_approvals"])("%s rows cannot be updated or deleted, even by the database owner", async (table) => {
    await asSystem(db)
    const r = await one<{ id: string }>(`select id from ${table} where submission_id = $1 limit 1`, [ids.subC])
    expect(r).toBeDefined()
    await fails(`update ${table} set submission_id = submission_id where id = $1`, [r.id], /append-only/)
    await fails(`delete from ${table} where id = $1`, [r.id], /append-only/)
    expect(await one(`select count(*)::int as n from ${table} where id = $1`, [r.id])).toEqual({ n: 1 })
  })

  it("signed-in users cannot change history either", async () => {
    await asUser(db, ids.admin)
    await fails("update submission_versions set change_summary = 'x' where submission_id = $1", [ids.subC], /permission denied|append-only/)
    await fails("delete from client_approvals where submission_id = $1", [ids.subC], /permission denied|append-only/)
  })

  it("deleting a submission is refused, so its history cannot be lost through a cascade", async () => {
    await asSystem(db)
    const before = await one<{ v: number; r: number; a: number; e: number }>(
      `select (select count(*)::int from submission_versions where submission_id = $1) as v,
              (select count(*)::int from internal_reviews where submission_id = $1) as r,
              (select count(*)::int from client_approvals where submission_id = $1) as a,
              (select count(*)::int from submission_events where submission_id = $1) as e`,
      [ids.subC],
    )
    expect(before.v).toBeGreaterThan(0)
    await fails("delete from backlink_submissions where id = $1", [ids.subC], /append-only/)
    expect(
      await one(
        `select (select count(*)::int from submission_versions where submission_id = $1) as v,
                (select count(*)::int from internal_reviews where submission_id = $1) as r,
                (select count(*)::int from client_approvals where submission_id = $1) as a,
                (select count(*)::int from submission_events where submission_id = $1) as e`,
        [ids.subC],
      ),
    ).toEqual(before)
    expect(await one("select count(*)::int as n from backlink_submissions where id = $1", [ids.subC])).toEqual({ n: 1 })
  })
})

describe("legacy versions written before this migration", () => {
  it("a resubmission compares against a legacy snapshot correctly and leaves the legacy row untouched", async () => {
    // A submission whose v1 was written by the old code: material-only snapshot, old hash, no change_type.
    const sub = await save(null, "R", {}, false)
    await asSystem(db)
    await db.query(
      `insert into submission_versions (submission_id, version, snapshot, content_hash, is_material_change, change_summary)
       select s.id, 1,
         jsonb_build_object('proposed_website', s.proposed_website, 'placement_url', s.placement_url, 'target_url', s.target_url,
           'anchor_text', s.anchor_text, 'content_title', s.content_title, 'content_draft', s.content_draft,
           'link_attribute', s.link_attribute, 'backlink_type_id', s.backlink_type_id, 'keyword_id', s.keyword_id),
         md5('legacy-scheme'), true, null
       from backlink_submissions s where s.id = $1`,
      [sub],
    )
    await db.query("update backlink_submissions set current_version = 1, status = 'submitted' where id = $1", [sub])
    await requestInternalChanges(sub)
    await save(sub, "R", { website_relevance: "Updated relevance only" })
    const v = await versions(sub)
    // Material fields equal the legacy snapshot → not material; non-material fields were not recorded → 'minor'.
    expect(v).toEqual([
      { version: 1, change_type: null, is_material_change: true, approval_carried_from: null, change_summary: null },
      { version: 2, change_type: "minor", is_material_change: false, approval_carried_from: null, change_summary: null },
    ])
  })
})

describe("function permissions for the new helpers", () => {
  it("signed-in users cannot execute the internal versioning helpers", async () => {
    await asSystem(db)
    const r = await rows<{ name: string; can: boolean }>(
      `select p.proname as name, has_function_privilege('authenticated', p.oid, 'execute') as can from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('_snapshot_submission', '_submission_snapshot', '_client_approval_covers_current', 'prevent_history_mutation')
       order by 1`,
    )
    expect(r).toEqual([
      { name: "_client_approval_covers_current", can: false },
      { name: "_snapshot_submission", can: false },
      { name: "_submission_snapshot", can: false },
      { name: "prevent_history_mutation", can: false },
    ])
  })
})

describe("rollback (supabase/rollbacks/20261019000016_submission_versioning.rollback.sql)", () => {
  // Runs last, on the database the tests above filled with versioned history.
  const catalog = async (d: Db) => {
    const fns = await d.query(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, pg_get_functiondef(p.oid) as def,
         coalesce(p.proacl::text, '') as acl
       from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`,
    )
    const triggers = await d.query(
      "select tgrelid::regclass::text || '.' || tgname as t from pg_trigger where not tgisinternal order by 1",
    )
    return { fns: fns.rows, triggers: triggers.rows }
  }

  it("restores exactly the pre-16 functions, permissions and triggers, keeps all history, and fails safe", async () => {
    // A submission whose current version relies on a carried-forward approval.
    await asUser(db, ids.intern)
    const carried = await save(null, "N", {})
    await approveAndForward(carried)
    await clientDecides("N", carried, "approved", 1)
    await asUser(db, ids.admin)
    await db.query("select submission_admin_edit($1, $2, 'edit')", [carried, JSON.stringify({ ...article, anchor_text: "carried anchor" })])
    expect((await versions(carried)).at(-1)).toMatchObject({ version: 2, approval_carried_from: 1 })

    await asSystem(db)
    const counts = "select (select count(*) from submission_versions) || '/' || (select count(*) from internal_reviews) || '/' || (select count(*) from client_approvals) || '/' || (select count(*) from submission_versions where change_type is not null) as n"
    const before = (await one<{ n: string }>(counts)).n
    // Rollbacks run newest first: 21 replaces functions that 16's rollback restores.
    const rollbackFile = (name: string) => readFileSync(join(__dirname, "..", "..", "supabase", "rollbacks", name), "utf8")
    await db.exec(`begin;\n${rollbackFile("20261023000021_workflow_consistency.rollback.sql")}\ncommit;`)
    await db.exec(`begin;\n${rollbackFile("20261019000016_submission_versioning.rollback.sql")}\ncommit;`)

    const pre16 = await createDb(undefined, ["20261019000016", "20261023000021"]) // every migration except 16 and 21
    const [now, expected] = [await catalog(db), await catalog(pre16)]
    await pre16.close()
    expect(now.triggers).toEqual(expected.triggers)
    expect(now.fns).toEqual(expected.fns)
    // History and the two added columns survive; the old code ignores the columns.
    expect((await one<{ n: string }>(counts)).n).toBe(before)

    // Old behaviour is back (a minor resubmission does not version) and the carried-forward submission is not publishable.
    const sub = await save(null, "R", {})
    await requestInternalChanges(sub)
    await save(sub, "R", { website_relevance: "minor only" })
    expect((await versions(sub)).length).toBe(1)
    await asUser(db, ids.intern)
    await expect(db.query("select submission_record_publication($1, 'https://publisher.example.org/p/c', current_date, 'dofollow')", [carried])).rejects.toThrow(/has no recorded approval/)
  }, 60_000)
})
