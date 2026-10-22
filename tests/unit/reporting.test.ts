import { describe, expect, it } from "vitest"
import {
  addDays,
  buildReport,
  dailySeries,
  localDate,
  pivot,
  presetRange,
  targetAllocations,
  utcRange,
  weekStart,
  type ReportEvent,
  type TaskTarget,
} from "@/lib/reporting"

const base = { client_id: "cl1", campaign_id: "cmp1", keyword_id: "kw1", intern_id: "rahul", backlink_type_id: "dir" }
const ev = (submission_id: string, metric: ReportEvent["metric"], occurred_at: string, over: Partial<ReportEvent> = {}): ReportEvent => ({
  ...base,
  submission_id,
  metric,
  occurred_at,
  ...over,
})
const labels = {
  campaign: { cmp1: "CMP-001", cmp2: "CMP-002", cmp3: "CMP-003" },
  backlink_type: { dir: "Directory", guest: "Guest Post", cit: "Citation" },
  intern: { rahul: "Rahul", anjali: "Anjali" },
  client: { cl1: "Smile Dental" },
  keyword: { kw1: "Dental Clinic Kerala" },
}

describe("time zones", () => {
  it("buckets events by the calendar date in the report time zone", () => {
    // 20:00 UTC on Oct 12 is 01:30 on Oct 13 in India
    expect(localDate("2026-10-12T20:00:00Z", "Asia/Kolkata")).toBe("2026-10-13")
    expect(localDate("2026-10-12T20:00:00Z", "America/New_York")).toBe("2026-10-12")
  })

  it("converts a calendar range to a half-open UTC interval", () => {
    const r = utcRange("2026-10-12", "2026-10-12", "Asia/Kolkata")
    expect(r.start.toISOString()).toBe("2026-10-11T18:30:00.000Z")
    expect(r.end.toISOString()).toBe("2026-10-12T18:30:00.000Z")
  })

  it("handles DST transitions", () => {
    const r = utcRange("2026-11-01", "2026-11-01", "America/New_York")
    expect(r.end.getTime() - r.start.getTime()).toBe(25 * 3600_000)
  })

  it("computes presets", () => {
    const now = new Date("2026-10-14T06:00:00Z") // Wednesday
    expect(presetRange("today", "Asia/Kolkata", now)).toEqual({ from: "2026-10-14", to: "2026-10-14" })
    expect(presetRange("this_week", "Asia/Kolkata", now)).toEqual({ from: "2026-10-12", to: "2026-10-14" })
    expect(presetRange("last_month", "Asia/Kolkata", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" })
    expect(weekStart("2026-10-18")).toBe("2026-10-12")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
  })
})

describe("buildReport", () => {
  it("counts each event on its own date (submitted Monday, approved Wednesday)", () => {
    const events = [
      ev("s1", "submitted", "2026-10-12T05:00:00Z"),
      ev("s1", "internally_approved", "2026-10-14T05:00:00Z"),
    ]
    const { rows } = buildReport({ events, from: "2026-10-12", to: "2026-10-14", timeZone: "Asia/Kolkata", groupBy: ["date"], labels })
    const byDate = Object.fromEntries(rows.map((r) => [r.dims.date!.id, r]))
    expect(byDate["2026-10-12"].submitted).toBe(1)
    expect(byDate["2026-10-12"].internally_approved).toBe(0)
    expect(byDate["2026-10-14"].internally_approved).toBe(1)
    expect(byDate["2026-10-14"].submitted).toBe(0)
  })

  it("never counts the same submission milestone twice", () => {
    const events = [ev("s1", "submitted", "2026-10-12T05:00:00Z"), ev("s1", "submitted", "2026-10-12T09:00:00Z")]
    const { totals } = buildReport({ events, from: "2026-10-12", to: "2026-10-12", timeZone: "UTC", groupBy: [] })
    expect(totals.submitted).toBe(1)
  })

  it("excludes events outside the range after time zone conversion", () => {
    const events = [ev("s1", "published", "2026-10-11T19:00:00Z")] // Oct 12 00:30 IST
    expect(buildReport({ events, from: "2026-10-12", to: "2026-10-12", timeZone: "Asia/Kolkata", groupBy: [] }).totals.published).toBe(1)
    expect(buildReport({ events, from: "2026-10-12", to: "2026-10-12", timeZone: "UTC", groupBy: [] }).totals.published).toBe(0)
  })

  it("groups by several dimensions with labels and adds targets and pending", () => {
    const events = [
      ev("s1", "submitted", "2026-10-12T05:00:00Z"),
      ev("s2", "submitted", "2026-10-12T06:00:00Z", { intern_id: "anjali", backlink_type_id: "guest" }),
      ev("s2", "rejected", "2026-10-12T07:00:00Z", { intern_id: "anjali", backlink_type_id: "guest" }),
    ]
    const tasks: TaskTarget[] = [
      { id: "t1", ...base, cadence: "daily", target_quantity: 5, start_date: "2026-10-01", due_date: "2026-10-15", status: "in_progress" },
      { id: "t2", ...base, intern_id: "anjali", backlink_type_id: "guest", cadence: "daily", target_quantity: 2, start_date: "2026-10-01", due_date: null, status: "cancelled" },
    ]
    const submissions = [{ id: "s1", status: "submitted" as const, first_submitted_at: "2026-10-12T05:00:00Z", ...base }]
    const { rows, totals } = buildReport({ events, tasks, submissions, from: "2026-10-12", to: "2026-10-12", timeZone: "UTC", groupBy: ["intern"], labels })
    expect(rows.map((r) => [r.dims.intern!.label, r.target, r.submitted, r.rejected, r.pending])).toEqual([
      ["Anjali", 0, 1, 1, 0],
      ["Rahul", 5, 1, 0, 1],
    ])
    expect(totals).toMatchObject({ target: 5, submitted: 2, rejected: 1, pending: 1 })
  })
})

describe("targets", () => {
  const task = (over: Partial<TaskTarget>): TaskTarget => ({
    id: "t", ...base, cadence: "daily", target_quantity: 5, start_date: "2026-10-01", due_date: "2026-10-15", status: "not_started", ...over,
  })
  it("daily tasks contribute per active day within the range", () => {
    expect(targetAllocations(task({}), "2026-10-14", "2026-10-20").reduce((a, b) => a + b.quantity, 0)).toBe(10)
  })
  it("weekly tasks contribute once per week", () => {
    const a = targetAllocations(task({ cadence: "weekly", target_quantity: 10, due_date: null }), "2026-10-01", "2026-10-31")
    expect(a.map((x) => x.date)).toEqual(["2026-10-01", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"])
  })
  it("one-off tasks contribute on their due date", () => {
    expect(targetAllocations(task({ cadence: "one_off" }), "2026-10-15", "2026-10-15")).toEqual([{ date: "2026-10-15", quantity: 5 }])
    expect(targetAllocations(task({ cadence: "one_off" }), "2026-10-01", "2026-10-14")).toEqual([])
  })
})

describe("pivot (campaign × backlink type)", () => {
  it("builds the daily matrix with totals", () => {
    const events: ReportEvent[] = [
      ...Array.from({ length: 5 }, (_, i) => ev(`a${i}`, "submitted", "2026-10-12T05:00:00Z")),
      ...Array.from({ length: 2 }, (_, i) => ev(`b${i}`, "submitted", "2026-10-12T05:00:00Z", { backlink_type_id: "guest" })),
      ...Array.from({ length: 3 }, (_, i) => ev(`c${i}`, "submitted", "2026-10-12T05:00:00Z", { backlink_type_id: "cit" })),
      ...Array.from({ length: 3 }, (_, i) => ev(`d${i}`, "submitted", "2026-10-12T05:00:00Z", { campaign_id: "cmp2" })),
      ev("x", "internally_approved", "2026-10-12T05:00:00Z", { campaign_id: "cmp2" }),
    ]
    const p = pivot({ events, metric: "submitted", rowDim: "campaign", colDim: "backlink_type", from: "2026-10-12", to: "2026-10-12", timeZone: "UTC", labels, includeRows: ["cmp3"] })
    expect(p.columns.map((c) => c.label)).toEqual(["Citation", "Directory", "Guest Post"])
    expect(p.rows.map((r) => [r.label, r.cells.dir, r.cells.guest, r.cells.cit, r.total])).toEqual([
      ["CMP-001", 5, 2, 3, 10],
      ["CMP-002", 3, 0, 0, 3],
      ["CMP-003", 0, 0, 0, 0],
    ])
    expect(p.total).toBe(13)
    expect(p.columnTotals.dir).toBe(8)
  })
})

describe("dailySeries", () => {
  it("fills every day in range", () => {
    const s = dailySeries([ev("s1", "verified_live", "2026-10-13T05:00:00Z")], "2026-10-12", "2026-10-14", "UTC")
    expect(s.map((d) => [d.date, d.verified_live])).toEqual([
      ["2026-10-12", 0],
      ["2026-10-13", 1],
      ["2026-10-14", 0],
    ])
  })
})

describe("scheduledReportAnchor", () => {
  it("picks a day in the previous period on run days only", async () => {
    const { scheduledReportAnchor, weekStart } = await import("@/lib/reporting")
    expect(scheduledReportAnchor("daily", "2026-03-01")).toBe("2026-02-28")
    expect(scheduledReportAnchor("monthly", "2026-03-01")).toBe("2026-02-28")
    expect(scheduledReportAnchor("monthly", "2026-03-02")).toBeNull()
    const monday = weekStart("2026-10-21")
    expect(scheduledReportAnchor("weekly", monday)).toBe(new Date(Date.parse(`${monday}T00:00:00Z`) - 7 * 86400_000).toISOString().slice(0, 10))
    expect(scheduledReportAnchor("weekly", "2026-10-21") === null || weekStart("2026-10-21") === "2026-10-21").toBe(true)
    expect(scheduledReportAnchor("off", "2026-03-01")).toBeNull()
  })
})
