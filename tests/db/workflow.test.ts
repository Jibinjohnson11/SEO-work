import { beforeAll, describe, expect, it } from "vitest"
import { normalizeUrl, urlDomain } from "@/lib/url"
import { asService, asSystem, asUser, createDb, createUser, type Db } from "./harness"

// End-to-end workflow and permission tests against the real migrations (PGlite).
// Super Admin creates a client → campaign → assigns an intern → intern submits →
// admin reviews → client approves → publication → verification → report events.

let db: Db
const ids: Record<string, string> = {}

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows
}
async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const r = await rows<T>(sql, params)
  return r[0]
}
async function fails(sql: string, params: unknown[], pattern: RegExp) {
  await expect(db.query(sql, params)).rejects.toThrow(pattern)
}

const guestPost = {
  proposed_website: "https://healthjournal.example.org",
  placement_url: "https://healthjournal.example.org/write-for-us",
  target_url: "https://dentalcare.example.com/implants",
  anchor_text: "dental implants in Kochi",
  content_title: "What to expect from dental implant surgery",
  content_draft: "Draft body v1",
  domain_rating: "54",
}

beforeAll(async () => {
  db = await createDb()
  ids.admin = await createUser(db, "super_admin", "Owner Admin")
  ids.rahul = await createUser(db, "intern", "Rahul")
  ids.anjali = await createUser(db, "intern", "Anjali")
  ids.clientUserA = await createUser(db, "client", "Client A Reviewer")
  ids.clientUserB = await createUser(db, "client", "Client B Reviewer")
  ids.disabledIntern = await createUser(db, "intern", "Former Intern", "disabled")

  await asUser(db, ids.admin)
  ids.clientA = (
    await one<{ id: string }>(
      `insert into clients (company_name, website_url, is_medical, timezone)
       values ('Smile Dental', 'https://dentalcare.example.com', true, 'Asia/Kolkata') returning id`,
    )
  ).id
  ids.clientB = (
    await one<{ id: string }>(`insert into clients (company_name) values ('Other Co') returning id`)
  ).id
  await db.query("insert into client_members (client_id, user_id) values ($1, $2), ($3, $4)", [
    ids.clientA,
    ids.clientUserA,
    ids.clientB,
    ids.clientUserB,
  ])
  ids.campaign = (
    await one<{ id: string }>(
      `insert into campaigns (name, client_id, status, monthly_target, target_url)
       values ('Dental Implants Kochi', $1, 'active', 20, 'https://dentalcare.example.com/implants') returning id`,
      [ids.clientA],
    )
  ).id
  ids.campaignB = (
    await one<{ id: string }>(
      `insert into campaigns (name, client_id, status) values ('Other campaign', $1, 'active') returning id`,
      [ids.clientB],
    )
  ).id
  ids.keyword = (
    await one<{ id: string }>(
      `insert into keywords (keyword, client_id, search_intent) values ('Dental Clinic Kerala', $1, 'local') returning id`,
      [ids.clientA],
    )
  ).id
  await db.query("insert into campaign_keywords (campaign_id, keyword_id, is_primary) values ($1, $2, true)", [
    ids.campaign,
    ids.keyword,
  ])
  ids.guestType = (await one<{ id: string }>("select id from backlink_types where slug = 'guest-posting'")).id
  ids.directoryType = (await one<{ id: string }>("select id from backlink_types where slug = 'business-directory'")).id
  ids.task = (
    await one<{ id: string }>(
      `insert into tasks (title, intern_id, campaign_id, keyword_id, backlink_type_id, cadence, target_quantity, due_date)
       values ('Guest posts for implants', $1, $2, $3, $4, 'daily', 2, current_date + 5) returning id`,
      [ids.rahul, ids.campaign, ids.keyword, ids.guestType],
    )
  ).id
}, 60_000)

describe("setup by Super Admin", () => {
  it("generates readable codes", async () => {
    await asUser(db, ids.admin)
    const c = await one<{ code: string }>("select code from campaigns where id = $1", [ids.campaign])
    expect(c.code).toMatch(/^CMP-\d{3}$/)
  })

  it("auto-assigns the intern to the campaign when a task is created and notifies them", async () => {
    await asUser(db, ids.admin)
    const a = await rows("select * from intern_assignments where intern_id = $1 and campaign_id = $2", [
      ids.rahul,
      ids.campaign,
    ])
    expect(a).toHaveLength(1)
    const t = await one<{ client_id: string }>("select client_id from tasks where id = $1", [ids.task])
    expect(t.client_id).toBe(ids.clientA)
    await asUser(db, ids.rahul)
    const n = await rows("select * from notifications where type = 'task_assigned'")
    expect(n).toHaveLength(1)
  })

  it("rejects keywords from another client on a campaign", async () => {
    await asUser(db, ids.admin)
    const kw = await one<{ id: string }>(
      "insert into keywords (keyword, client_id) values ('other kw', $1) returning id",
      [ids.clientB],
    )
    await fails("insert into campaign_keywords (campaign_id, keyword_id) values ($1, $2)", [ids.campaign, kw.id], /different clients/)
  })
})

describe("tenant isolation and role permissions", () => {
  it("interns only see campaigns they are assigned to", async () => {
    await asUser(db, ids.rahul)
    expect(await rows("select id from campaigns")).toHaveLength(1)
    expect(await rows("select id from clients")).toHaveLength(1)
    expect(await rows("select id from keywords")).toHaveLength(1)
    await asUser(db, ids.anjali)
    expect(await rows("select id from campaigns")).toHaveLength(0)
    expect(await rows("select id from clients")).toHaveLength(0)
  })

  it("client users cannot read internal tables and only see their own workspace via the portal", async () => {
    await asUser(db, ids.clientUserA)
    expect(await rows("select id from campaigns")).toHaveLength(0)
    expect(await rows("select id from clients")).toHaveLength(0)
    expect(await rows("select id from tasks")).toHaveLength(0)
    const mine = await rows<{ id: string }>("select id from client_portal_campaigns()")
    expect(mine.map((r) => r.id)).toEqual([ids.campaign])
    await asUser(db, ids.clientUserB)
    const theirs = await rows<{ id: string }>("select id from client_portal_campaigns()")
    expect(theirs.map((r) => r.id)).toEqual([ids.campaignB])
  })

  it("interns and clients cannot call portal functions of other roles", async () => {
    await asUser(db, ids.rahul)
    await fails("select * from client_portal_campaigns()", [], /Client access required/)
  })

  it("non-admins cannot write configuration tables", async () => {
    await asUser(db, ids.rahul)
    await fails("insert into clients (company_name) values ('Sneaky')", [], /row-level security/)
    await asUser(db, ids.clientUserA)
    await fails("insert into campaigns (name, client_id) values ('x', $1)", [ids.clientA], /row-level security/)
  })

  it("nobody can write submissions directly (workflow functions only)", async () => {
    await asUser(db, ids.rahul)
    await fails(
      `insert into backlink_submissions (client_id, campaign_id, intern_id, backlink_type_id, proposed_website, proposed_domain, target_url)
       values ($1, $2, $3, $4, 'x', 'x', 'https://x.com')`,
      [ids.clientA, ids.campaign, ids.rahul, ids.guestType],
      /permission denied/,
    )
    await asUser(db, ids.admin)
    await fails("update backlink_submissions set status = 'verified_live'", [], /permission denied/)
  })

  it("roles cannot be escalated from the application", async () => {
    await asUser(db, ids.rahul)
    await fails("update profiles set role = 'super_admin' where id = $1", [ids.rahul], /Only a Super Admin/)
    await fails("update profiles set daily_target = 10 where id = $1", [ids.rahul], /Only a Super Admin/)
    // Self-service fields are allowed
    await db.query("update profiles set full_name = 'Rahul K' where id = $1", [ids.rahul])
    await asUser(db, ids.admin)
    await fails("update profiles set role = 'super_admin' where id = $1", [ids.anjali], /database administrator/)
    await fails("update profiles set status = 'disabled' where id = $1", [ids.admin], /own account/)
  })

  it("disabled users lose all access", async () => {
    await asUser(db, ids.disabledIntern)
    const r = await one<{ role: string | null }>("select auth_role() as role")
    expect(r.role).toBeNull()
    expect(await rows("select * from backlink_types")).toHaveLength(0)
  })

  it("activity logs are admin-only and append-only", async () => {
    await asUser(db, ids.rahul)
    expect(await rows("select * from activity_logs")).toHaveLength(0)
    await asUser(db, ids.admin)
    expect((await rows("select * from activity_logs")).length).toBeGreaterThan(0)
    await fails("delete from activity_logs", [], /permission denied/)
    await asSystem(db)
    await fails("delete from activity_logs", [], /append-only/)
  })
})

describe("submission → review → client approval → publication → verification", () => {
  it("intern saves a draft then submits; required fields per backlink type are enforced", async () => {
    await asUser(db, ids.rahul)
    const base = { ...guestPost, campaign_id: ids.campaign, backlink_type_id: ids.guestType, keyword_id: ids.keyword, task_id: ids.task }
    const draft = await one<{ id: string }>("select submission_save(null, $1, false) as id", [
      JSON.stringify({ ...base, content_title: "" }),
    ])
    ids.sub1 = draft.id
    await fails("select submission_save($1, $2, true)", [ids.sub1, JSON.stringify({ ...base, content_title: "" })], /content title.*required/i)
    await db.query("select submission_save($1, $2, true)", [ids.sub1, JSON.stringify(base)])
    const s = await one<{ status: string; current_version: number; proposed_domain: string }>(
      "select status, current_version, proposed_domain from backlink_submissions where id = $1",
      [ids.sub1],
    )
    expect(s).toMatchObject({ status: "submitted", current_version: 1, proposed_domain: "healthjournal.example.org" })
    const task = await one<{ status: string }>("select status from tasks where id = $1", [ids.task])
    expect(task.status).toBe("in_progress")
  })

  it("interns cannot submit to campaigns they are not assigned to", async () => {
    await asUser(db, ids.anjali)
    await fails(
      "select submission_save(null, $1, true)",
      [JSON.stringify({ ...guestPost, campaign_id: ids.campaign, backlink_type_id: ids.guestType })],
      /not assigned/,
    )
  })

  it("other interns cannot see the submission; admin is notified", async () => {
    await asUser(db, ids.anjali)
    expect(await rows("select id from backlink_submissions")).toHaveLength(0)
    await asUser(db, ids.admin)
    const n = await rows("select * from notifications where type = 'submission_received' and entity_id = $1", [ids.sub1])
    expect(n).toHaveLength(1)
  })

  it("interns cannot review their own work", async () => {
    await asUser(db, ids.rahul)
    await fails("select submission_internal_decision($1, 'approved', 'ok')", [ids.sub1], /Super Admin access required/)
  })

  it("medical content requires the medical review checklist before internal approval", async () => {
    await asUser(db, ids.admin)
    await db.query("select submission_start_review($1)", [ids.sub1])
    await fails("select submission_internal_decision($1, 'approved', 'looks good', '{}', null, true)", [ids.sub1], /Medical review checklist/)
    await fails(
      "select submission_internal_decision($1, 'approved', 'looks good', '{}', $2, true)",
      [ids.sub1, JSON.stringify({ medical_accuracy_reviewed: true, claims_verified: false, sources_checked: true, medical_reviewer_name: "Dr. A" })],
      /Medical review checklist/,
    )
  })

  it("internal changes requested returns work to the intern, who revises it as a new version", async () => {
    await asUser(db, ids.admin)
    await fails("select submission_internal_decision($1, 'changes_requested', '')", [ids.sub1], /Feedback is required/)
    await db.query("select submission_internal_decision($1, 'changes_requested', 'Cite sources for success rates')", [ids.sub1])
    await asUser(db, ids.rahul)
    const fb = await rows("select comments from internal_reviews where submission_id = $1", [ids.sub1])
    expect(fb).toEqual([{ comments: "Cite sources for success rates" }])
    await db.query("select submission_save($1, $2, true)", [
      ids.sub1,
      JSON.stringify({ ...guestPost, backlink_type_id: ids.guestType, keyword_id: ids.keyword, task_id: ids.task, content_draft: "Draft body v2 with sources" }),
    ])
    const s = await one<{ status: string; current_version: number }>("select status, current_version from backlink_submissions where id = $1", [ids.sub1])
    expect(s).toEqual({ status: "submitted", current_version: 2 })
  })

  it("approves internally with medical review and forwards to the client", async () => {
    await asUser(db, ids.admin)
    await db.query("select submission_internal_decision($1, 'approved', 'Good', $2, $3, true)", [
      ids.sub1,
      JSON.stringify({ relevance: true }),
      JSON.stringify({ medical_accuracy_reviewed: true, claims_verified: true, sources_checked: true, medical_reviewer_name: "Dr. Meera", medical_reviewer_qualification: "BDS" }),
    ])
    const s = await one<{ status: string }>("select status from backlink_submissions where id = $1", [ids.sub1])
    expect(s.status).toBe("awaiting_client_approval")
    await asUser(db, ids.clientUserA)
    const n = await rows("select * from notifications where type = 'client_approval_requested'")
    expect(n).toHaveLength(1)
    const queue = await rows<{ id: string; current_version: number }>("select id, current_version from client_portal_submissions(true)")
    expect(queue).toEqual([{ id: ids.sub1, current_version: 2 }])
  })

  it("client decisions are scoped to their own workspace and to the exact version shown", async () => {
    await asUser(db, ids.clientUserB)
    await fails("select submission_client_decision($1, 'approved', null, 2)", [ids.sub1], /not found/)
    await asUser(db, ids.clientUserA)
    await fails("select submission_client_decision($1, 'approved', null, 1)", [ids.sub1], /content changed/)
    await fails("select submission_client_decision($1, 'rejected', ' ', 2)", [ids.sub1], /reason/)
    await asUser(db, ids.admin)
    await fails("select submission_client_decision($1, 'approved', null, 2)", [ids.sub1], /Only client users/)
    await fails("select submission_admin_override($1, 'client unresponsive')", [ids.sub1], /disabled/)
  })

  it("client approves; approval is recorded separately from internal approval", async () => {
    await asUser(db, ids.clientUserA)
    await db.query("select submission_client_decision($1, 'approved', 'Great article', 2)", [ids.sub1])
    const detail = await one<{ v: { status: string; decisions: unknown[] } }>("select client_portal_submission($1) as v", [ids.sub1])
    expect(detail.v.status).toBe("client_approved")
    expect(detail.v.decisions).toHaveLength(1)
    await asUser(db, ids.admin)
    const ca = await one("select version, decision, is_admin_override, decided_by from client_approvals where submission_id = $1", [ids.sub1])
    expect(ca).toEqual({ version: 2, decision: "approved", is_admin_override: false, decided_by: ids.clientUserA })
  })

  it("material admin edits after approval require re-approval", async () => {
    await asUser(db, ids.rahul)
    const sub = await one<{ id: string }>("select submission_save(null, $1, true) as id", [
      JSON.stringify({ ...guestPost, campaign_id: ids.campaign, backlink_type_id: ids.guestType, placement_url: "https://healthjournal.example.org/second" }),
    ])
    ids.sub2 = sub.id
    await asUser(db, ids.admin)
    const medical = JSON.stringify({ medical_accuracy_reviewed: true, claims_verified: true, sources_checked: true, medical_reviewer_name: "Dr. Meera" })
    await db.query("select submission_internal_decision($1, 'approved', 'ok', '{}', $2, true)", [ids.sub2, medical])
    await asUser(db, ids.clientUserA)
    await db.query("select submission_client_decision($1, 'approved', null, 1)", [ids.sub2])
    await asUser(db, ids.admin)
    // Non-material edit: no new version
    await db.query("select submission_admin_edit($1, $2, 'notes only')", [
      ids.sub2,
      JSON.stringify({ ...guestPost, placement_url: "https://healthjournal.example.org/second", notes: "internal note" }),
    ])
    let s = await one<{ status: string; current_version: number }>("select status, current_version from backlink_submissions where id = $1", [ids.sub2])
    expect(s).toEqual({ status: "client_approved", current_version: 1 })
    await db.query("select submission_admin_edit($1, $2, 'tightened anchor')", [
      ids.sub2,
      JSON.stringify({ ...guestPost, placement_url: "https://healthjournal.example.org/second", anchor_text: "implant dentist Kochi" }),
    ])
    s = await one("select status, current_version from backlink_submissions where id = $1", [ids.sub2])
    expect(s).toEqual({ status: "awaiting_client_approval", current_version: 2 })
  })

  it("only approved content can be published, and a placement is counted once", async () => {
    await asUser(db, ids.rahul)
    await fails("select submission_record_publication($1, 'https://healthjournal.example.org/p/2', current_date, 'dofollow')", [ids.sub2], /Only approved/)
    const pub = await one<{ id: string }>(
      "select submission_record_publication($1, 'https://www.healthjournal.example.org/p/implants/', current_date, 'dofollow') as id",
      [ids.sub1],
    )
    ids.pub1 = pub.id
    const s = await one<{ status: string }>("select status from backlink_submissions where id = $1", [ids.sub1])
    expect(s.status).toBe("verification_pending")

    // A second approved submission pointing at the same placement and target is rejected as a duplicate.
    await asUser(db, ids.clientUserA)
    await db.query("select submission_client_decision($1, 'approved', null, 2)", [ids.sub2])
    await asUser(db, ids.rahul)
    await fails(
      "select submission_record_publication($1, 'http://healthjournal.example.org/p/implants#top', current_date, 'dofollow')",
      [ids.sub2],
      /already recorded as published/,
    )
  })

  it("published does not mean verified; verification records results and updates status", async () => {
    await asUser(db, ids.admin)
    let pb = await one<{ live_status: string; first_verified_live_at: string | null }>(
      "select live_status, first_verified_live_at from published_backlinks where id = $1",
      [ids.pub1],
    )
    expect(pb).toEqual({ live_status: "pending_verification", first_verified_live_at: null })

    await asUser(db, ids.rahul)
    await fails("select record_verification($1, $2)", [ids.pub1, JSON.stringify({ result: "live" })], /Super Admin access required/)

    await asService(db)
    await db.query("select record_verification($1, $2)", [
      ids.pub1,
      JSON.stringify({ result: "live", method: "automated", http_status: 200, link_found: true, found_rel: [], detected_attribute: "dofollow" }),
    ])
    await asUser(db, ids.admin)
    pb = await one("select live_status, first_verified_live_at from published_backlinks where id = $1", [ids.pub1])
    expect(pb.live_status).toBe("live")
    expect(pb.first_verified_live_at).not.toBeNull()

    await fails("select record_verification($1, $2)", [ids.pub1, JSON.stringify({ result: "missing", method: "manual" })], /requires notes/)
    await db.query("select record_verification($1, $2)", [ids.pub1, JSON.stringify({ result: "missing", method: "manual", notes: "Link removed by editor" })])
    const s = await one<{ status: string }>("select status from backlink_submissions where id = $1", [ids.sub1])
    expect(s.status).toBe("verification_failed")
    const n = await rows("select * from notifications where type = 'verification_failed'")
    expect(n).toHaveLength(1)
    // Recovery counts as verified again, but the milestone is not double counted.
    await db.query("select record_verification($1, $2)", [ids.pub1, JSON.stringify({ result: "live", method: "manual", notes: "Restored" })])
  })

  it("report events count each milestone once per submission despite revisions and re-checks", async () => {
    await asUser(db, ids.admin)
    const counts = await rows<{ metric: string; n: number }>(
      "select metric, count(*)::int as n from report_events where submission_id = $1 group by metric order by metric",
      [ids.sub1],
    )
    expect(counts).toEqual([
      { metric: "client_approved", n: 1 },
      { metric: "internally_approved", n: 1 },
      { metric: "published", n: 1 },
      { metric: "submitted", n: 1 },
      { metric: "verified_live", n: 1 },
    ])
    const events = await rows("select to_status from submission_events where submission_id = $1 and to_status = 'submitted'", [ids.sub1])
    expect(events).toHaveLength(2)
  })

  it("interns only see their own report events", async () => {
    await asUser(db, ids.anjali)
    expect(await rows("select * from report_events")).toHaveLength(0)
    await asUser(db, ids.rahul)
    expect((await rows("select * from report_events")).length).toBeGreaterThan(0)
  })

  it("rejected submissions can be reassigned to another intern for rework", async () => {
    await asUser(db, ids.rahul)
    const sub = await one<{ id: string }>("select submission_save(null, $1, true) as id", [
      JSON.stringify({ ...guestPost, campaign_id: ids.campaign, backlink_type_id: ids.guestType, placement_url: "https://healthjournal.example.org/third" }),
    ])
    await asUser(db, ids.admin)
    await db.query("select submission_internal_decision($1, 'rejected', 'Off-topic publisher')", [sub.id])
    await db.query("select submission_reassign($1, $2, 'Try a dental publisher')", [sub.id, ids.anjali])
    await asUser(db, ids.anjali)
    const s = await one<{ status: string }>("select status from backlink_submissions where id = $1", [sub.id])
    expect(s.status).toBe("internal_changes_requested")
    await asUser(db, ids.rahul)
    expect(await rows("select id from backlink_submissions where id = $1", [sub.id])).toHaveLength(0)
  })

  it("notifications are de-duplicated", async () => {
    await asUser(db, ids.admin)
    await db.query("select notify_due_tasks(7)")
    await db.query("select notify_due_tasks(7)")
    await asUser(db, ids.rahul)
    const due = await rows("select * from notifications where type = 'deadline_approaching'")
    expect(due).toHaveLength(1)
  })
})

describe("URL normalization parity (SQL ↔ TypeScript)", () => {
  const samples = [
    "https://www.Example.com/Path/",
    "http://example.com:80/a/b?x=1#frag",
    "example.com",
    "https://user:pw@EXAMPLE.com:443/",
    "https://sub.example.co.uk/page?",
    "HTTPS://WWW.EXAMPLE.COM.",
    "https://example.com/a//",
    "ftp://files.example.com/x",
  ]
  it.each(samples)("%s", async (url) => {
    await asSystem(db)
    const r = await one<{ n: string; d: string }>("select normalize_url($1) as n, url_domain($1) as d", [url])
    expect(normalizeUrl(url)).toBe(r.n)
    expect(urlDomain(url)).toBe(r.d)
  })
})

describe("report publishing", () => {
  it("publishes a client report, notifies the client and keeps other clients out", async () => {
    await asUser(db, ids.admin)
    const r = await one<{ id: string }>(
      `insert into reports (kind, client_id, title, period_start, period_end, timezone, data)
       values ('daily', $1, 'Daily report', current_date, current_date, 'Asia/Kolkata', '{}') returning id`,
      [ids.clientA],
    )
    await asUser(db, ids.clientUserA)
    expect(await rows("select id from reports")).toHaveLength(0)
    await fails("select report_set_published($1, true)", [r.id], /Super Admin access required/)
    await asUser(db, ids.admin)
    await db.query("select report_set_published($1, true)", [r.id])
    await asUser(db, ids.clientUserA)
    expect(await rows("select id from reports")).toHaveLength(1)
    expect(await rows("select id from notifications where type = 'report_published'")).toHaveLength(1)
    await asUser(db, ids.clientUserB)
    expect(await rows("select id from reports")).toHaveLength(0)
  })

  it("refuses to publish intern-level reports to clients whose portal hides team names", async () => {
    await asUser(db, ids.admin)
    const r = await one<{ id: string }>(
      `insert into reports (kind, client_id, title, period_start, period_end, timezone, data, filters)
       values ('daily', $1, 'By intern', current_date, current_date, 'UTC', '{}', '{"group":"intern"}') returning id`,
      [ids.clientA],
    )
    await fails("select report_set_published($1, true)", [r.id], /hides team member names/)
  })
})
