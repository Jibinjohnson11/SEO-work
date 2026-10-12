import { TZDate } from "@date-fns/tz"
import { PENDING_STATUSES } from "@/lib/workflow"
import type { SubmissionStatus, TaskCadence, TaskStatus } from "@/lib/types"

// Timestamp-based reporting. Every count comes from the first time a submission reached a
// milestone (public.report_events), bucketed by the calendar date in the report time zone.
// A submission submitted Monday and approved Wednesday counts as "submitted" on Monday and
// "approved" on Wednesday, and revisions never count twice.

export const METRICS = [
  "submitted",
  "internally_approved",
  "client_approved",
  "published",
  "verified_live",
  "rejected",
] as const
export type Metric = (typeof METRICS)[number]

export const METRIC_LABEL: Record<Metric | "target" | "pending", string> = {
  target: "Assigned Target",
  submitted: "Submitted",
  internally_approved: "Internal Approved",
  client_approved: "Client Approved",
  published: "Published",
  verified_live: "Verified Live",
  rejected: "Rejected",
  pending: "Pending",
}

export const DIMENSIONS = ["date", "client", "campaign", "keyword", "intern", "backlink_type"] as const
export type Dimension = (typeof DIMENSIONS)[number]

export const DIMENSION_LABEL: Record<Dimension, string> = {
  date: "Date",
  client: "Client",
  campaign: "Campaign",
  keyword: "Keyword",
  intern: "Intern",
  backlink_type: "Backlink Type",
}

export interface ReportEvent {
  submission_id: string
  metric: Metric
  occurred_at: string
  client_id: string
  campaign_id: string
  keyword_id: string | null
  intern_id: string
  backlink_type_id: string
}

export interface TaskTarget {
  id: string
  intern_id: string
  campaign_id: string
  client_id: string
  keyword_id: string | null
  backlink_type_id: string | null
  cadence: TaskCadence
  target_quantity: number
  start_date: string
  due_date: string | null
  status: TaskStatus
}

export interface SubmissionSnapshot {
  id: string
  status: SubmissionStatus
  first_submitted_at: string | null
  client_id: string
  campaign_id: string
  keyword_id: string | null
  intern_id: string
  backlink_type_id: string
}

export type Labels = Partial<Record<Exclude<Dimension, "date">, Record<string, string>>>

export interface ReportRow {
  key: string
  dims: Partial<Record<Dimension, { id: string; label: string }>>
  target: number
  submitted: number
  internally_approved: number
  client_approved: number
  published: number
  verified_live: number
  rejected: number
  pending: number
}

export type ReportTotals = Omit<ReportRow, "key" | "dims">

const UNSPECIFIED = "—"

// ---------------------------------------------------------------------------
// Date helpers (calendar dates are "YYYY-MM-DD" strings in the report time zone)
// ---------------------------------------------------------------------------
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
export function localDate(iso: string | Date, timeZone: string): string {
  let f = dateFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    dateFormatters.set(timeZone, f)
  }
  return f.format(typeof iso === "string" ? new Date(iso) : iso)
}

export function todayIn(timeZone: string, now: Date = new Date()) {
  return localDate(now, timeZone)
}

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number)
  return { y, m, d }
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parts(date)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Monday-based week start for a calendar date. */
export function weekStart(date: string): string {
  const { y, m, d } = parts(date)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow)
}

export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`
}

export function monthEnd(date: string) {
  const { y, m } = parts(date)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** UTC instant at which a calendar date begins in the given zone. */
export function zonedDayStart(date: string, timeZone: string): Date {
  const { y, m, d } = parts(date)
  return new Date(new TZDate(y, m - 1, d, timeZone).getTime())
}

/** Half-open UTC interval [start, end) covering calendar dates from..to in the zone. */
export function utcRange(from: string, to: string, timeZone: string) {
  return { start: zonedDayStart(from, timeZone), end: zonedDayStart(addDays(to, 1), timeZone) }
}

export type PeriodPreset = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "last_7" | "last_30"

export function presetRange(preset: PeriodPreset, timeZone: string, now: Date = new Date()) {
  const today = todayIn(timeZone, now)
  switch (preset) {
    case "today":
      return { from: today, to: today }
    case "yesterday": {
      const y = addDays(today, -1)
      return { from: y, to: y }
    }
    case "this_week":
      return { from: weekStart(today), to: today }
    case "last_week": {
      const start = addDays(weekStart(today), -7)
      return { from: start, to: addDays(start, 6) }
    }
    case "this_month":
      return { from: monthStart(today), to: today }
    case "last_month": {
      const prev = addDays(monthStart(today), -1)
      return { from: monthStart(prev), to: prev }
    }
    case "last_7":
      return { from: addDays(today, -6), to: today }
    case "last_30":
      return { from: addDays(today, -29), to: today }
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
interface DimSource {
  client_id: string
  campaign_id: string
  keyword_id: string | null
  intern_id: string
  backlink_type_id: string | null
}

function dimId(dim: Dimension, src: DimSource, date: string) {
  switch (dim) {
    case "date":
      return date
    case "client":
      return src.client_id
    case "campaign":
      return src.campaign_id
    case "keyword":
      return src.keyword_id ?? UNSPECIFIED
    case "intern":
      return src.intern_id
    case "backlink_type":
      return src.backlink_type_id ?? UNSPECIFIED
  }
}

function dimLabel(dim: Dimension, id: string, labels: Labels) {
  if (dim === "date" || id === UNSPECIFIED) return id === UNSPECIFIED ? "Unspecified" : id
  return labels[dim]?.[id] ?? "Unknown"
}

function emptyTotals(): ReportTotals {
  return { target: 0, submitted: 0, internally_approved: 0, client_approved: 0, published: 0, verified_live: 0, rejected: 0, pending: 0 }
}

/**
 * Targets attributed to calendar dates within [from, to]:
 * daily → quantity per active day; weekly/monthly → quantity once per period, on the first
 * active day of that period inside the range; one-off → quantity on its due (or start) date.
 */
export function targetAllocations(task: TaskTarget, from: string, to: string): { date: string; quantity: number }[] {
  if (task.status === "cancelled") return []
  if (task.cadence === "one_off") {
    const day = task.due_date ?? task.start_date
    return day >= from && day <= to ? [{ date: day, quantity: task.target_quantity }] : []
  }
  const start = task.start_date > from ? task.start_date : from
  const endBound = task.due_date && task.due_date < to ? task.due_date : to
  if (start > endBound) return []
  const out: { date: string; quantity: number }[] = []
  const seen = new Set<string>()
  for (const day of eachDay(start, endBound)) {
    if (task.cadence === "daily") out.push({ date: day, quantity: task.target_quantity })
    else {
      const period = task.cadence === "weekly" ? weekStart(day) : monthStart(day)
      if (!seen.has(period)) {
        seen.add(period)
        out.push({ date: day, quantity: task.target_quantity })
      }
    }
  }
  return out
}

export function buildReport(input: {
  events: ReportEvent[]
  tasks?: TaskTarget[]
  submissions?: SubmissionSnapshot[]
  from: string
  to: string
  timeZone: string
  groupBy: Dimension[]
  labels?: Labels
}): { rows: ReportRow[]; totals: ReportTotals } {
  const { from, to, timeZone, groupBy, labels = {} } = input
  const rows = new Map<string, ReportRow>()
  const totals = emptyTotals()

  const rowFor = (src: DimSource, date: string) => {
    const ids = groupBy.map((d) => dimId(d, src, date))
    const key = ids.join("|") || "all"
    let row = rows.get(key)
    if (!row) {
      row = { key, dims: {}, ...emptyTotals() }
      groupBy.forEach((d, i) => (row!.dims[d] = { id: ids[i], label: dimLabel(d, ids[i], labels) }))
      rows.set(key, row)
    }
    return row
  }

  const seen = new Set<string>()
  for (const e of input.events) {
    const date = localDate(e.occurred_at, timeZone)
    if (date < from || date > to) continue
    // Defensive: the view already yields one row per (submission, metric).
    const uniq = `${e.submission_id}:${e.metric}`
    if (seen.has(uniq)) continue
    seen.add(uniq)
    rowFor(e, date)[e.metric] += 1
    totals[e.metric] += 1
  }

  for (const task of input.tasks ?? []) {
    for (const a of targetAllocations(task, from, to)) {
      rowFor(task, a.date).target += a.quantity
      totals.target += a.quantity
    }
  }

  for (const s of input.submissions ?? []) {
    if (!s.first_submitted_at || !PENDING_STATUSES.includes(s.status)) continue
    const date = localDate(s.first_submitted_at, timeZone)
    if (date < from || date > to) continue
    rowFor(s, date).pending += 1
    totals.pending += 1
  }

  const sorted = [...rows.values()].sort((a, b) => {
    for (const d of groupBy) {
      const cmp =
        d === "date"
          ? b.dims[d]!.id.localeCompare(a.dims[d]!.id)
          : a.dims[d]!.label.localeCompare(b.dims[d]!.label, undefined, { numeric: true })
      if (cmp !== 0) return cmp
    }
    return 0
  })
  return { rows: sorted, totals }
}

export interface Pivot {
  columns: { id: string; label: string }[]
  rows: { id: string; label: string; cells: Record<string, number>; total: number }[]
  columnTotals: Record<string, number>
  total: number
}

/** e.g. campaigns × backlink types for one metric (the "daily report" matrix). */
export function pivot(input: {
  events: ReportEvent[]
  metric: Metric
  rowDim: Exclude<Dimension, "date">
  colDim: Exclude<Dimension, "date">
  from: string
  to: string
  timeZone: string
  labels?: Labels
  includeRows?: string[]
  includeColumns?: string[]
}): Pivot {
  const { labels = {} } = input
  const cells = new Map<string, Map<string, number>>()
  const colIds = new Set<string>(input.includeColumns ?? [])
  const rowIds = new Set<string>(input.includeRows ?? [])
  for (const e of input.events) {
    if (e.metric !== input.metric) continue
    const date = localDate(e.occurred_at, input.timeZone)
    if (date < input.from || date > input.to) continue
    const r = dimId(input.rowDim, e, date)
    const c = dimId(input.colDim, e, date)
    rowIds.add(r)
    colIds.add(c)
    const row = cells.get(r) ?? new Map<string, number>()
    row.set(c, (row.get(c) ?? 0) + 1)
    cells.set(r, row)
  }
  const byLabel = (a: { label: string }, b: { label: string }) =>
    a.label.localeCompare(b.label, undefined, { numeric: true })
  const columns = [...colIds].map((id) => ({ id, label: dimLabel(input.colDim, id, labels) })).sort(byLabel)
  const columnTotals: Record<string, number> = {}
  let total = 0
  const rows = [...rowIds]
    .map((id) => {
      const row = cells.get(id)
      const rowCells: Record<string, number> = {}
      let rowTotal = 0
      for (const col of columns) {
        const n = row?.get(col.id) ?? 0
        rowCells[col.id] = n
        rowTotal += n
        columnTotals[col.id] = (columnTotals[col.id] ?? 0) + n
      }
      total += rowTotal
      return { id, label: dimLabel(input.rowDim, id, labels), cells: rowCells, total: rowTotal }
    })
    .sort(byLabel)
  return { columns, rows, columnTotals, total }
}

export function dailySeries(events: ReportEvent[], from: string, to: string, timeZone: string) {
  const days = new Map(eachDay(from, to).map((d) => [d, { date: d, ...Object.fromEntries(METRICS.map((m) => [m, 0])) } as Record<string, number | string>]))
  const seen = new Set<string>()
  for (const e of events) {
    const date = localDate(e.occurred_at, timeZone)
    const day = days.get(date)
    if (!day) continue
    const uniq = `${e.submission_id}:${e.metric}`
    if (seen.has(uniq)) continue
    seen.add(uniq)
    day[e.metric] = (day[e.metric] as number) + 1
  }
  return [...days.values()] as ({ date: string } & Record<Metric, number>)[]
}

export function percent(numerator: number, denominator: number) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}
