import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { addDays, buildReport, METRIC_LABEL, monthEnd, monthStart, pivot, todayIn, weekStart, type Dimension, type ReportRow } from "@/lib/reporting"
import { formatDay } from "@/lib/format"
import type { ExportDoc } from "@/lib/export"
import type { SubmissionStatus } from "@/lib/types"
import { fetchAll, getLookups, labelMaps, param, type SearchParams } from "@/server/queries"
import { loadReportData, readFilters, type ReportFilters } from "@/server/report-data"

// The unified Reports dashboard (/admin/reports): one page for daily, weekly, monthly, yearly and
// custom periods. Every count comes from the same timestamped milestone events as before
// (public.report_events, first occurrence per submission), bucketed by calendar date in the
// reporting time zone over an inclusive [from, to] range, so a period switch never double-counts.

export const REPORT_PERIODS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly", custom: "Custom range" } as const
export type ReportPeriod = keyof typeof REPORT_PERIODS

/** Grouping options for the details table: the dimensions shown as columns for each. */
export const REPORT_GROUPS = {
  client: { label: "Brand", dims: ["client"] },
  campaign: { label: "Campaign", dims: ["client", "campaign"] },
  intern: { label: "Team Member", dims: ["intern"] },
  backlink_type: { label: "Backlink Type", dims: ["backlink_type"] },
} as const satisfies Record<string, { label: string; dims: Dimension[] }>
export type ReportGroup = keyof typeof REPORT_GROUPS

/** "Report status": the submission's current workflow stage. Filters events and submissions, not targets. */
export const REPORT_STATUSES = {
  pending: { label: "Pending review or client approval", statuses: ["submitted", "internal_review", "internal_changes_requested", "internally_approved", "awaiting_client_approval"] },
  changes: { label: "Changes requested", statuses: ["client_changes_requested"] },
  approved: { label: "Client approved", statuses: ["client_approved", "ready_for_publication"] },
  published: { label: "Published", statuses: ["published", "verification_pending"] },
  verified: { label: "Verified live", statuses: ["verified_live"] },
  failed: { label: "Verification failed", statuses: ["verification_failed"] },
  rejected: { label: "Rejected", statuses: ["internal_rejected", "client_rejected"] },
} as const satisfies Record<string, { label: string; statuses: SubmissionStatus[] }>
export type ReportStatusFilter = keyof typeof REPORT_STATUSES

/** Submitted but not yet decided by the client ("Pending approvals"). */
const AWAITING_APPROVAL: SubmissionStatus[] = [...REPORT_STATUSES.pending.statuses, "client_changes_requested"]

/** Metrics on this page. Internal approval is no longer a stage, so it is not reported. */
export const UNIFIED_METRICS = ["target", "submitted", "client_approved", "published", "verified_live", "rejected", "awaiting"] as const
export type UnifiedMetric = (typeof UNIFIED_METRICS)[number]
export const UNIFIED_LABEL: Record<UnifiedMetric, string> = {
  target: METRIC_LABEL.target,
  submitted: METRIC_LABEL.submitted,
  client_approved: METRIC_LABEL.client_approved,
  published: "Published Backlinks",
  verified_live: "Verified Backlinks",
  rejected: METRIC_LABEL.rejected,
  awaiting: "Pending Approvals",
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Period from the URL: `period` plus an anchor `date` (any day inside the wanted day / week / month /
 * year), or `from`/`to` for a custom range. A period that contains today ends today, so targets for
 * days that have not happened yet are not counted against completion.
 */
export function resolveReportPeriod(sp: SearchParams, timeZone: string) {
  const today = todayIn(timeZone)
  const raw = param(sp, "period")
  const period: ReportPeriod = raw in REPORT_PERIODS ? (raw as ReportPeriod) : param(sp, "from") ? "custom" : "daily"
  const anchorParam = param(sp, "date")
  const anchor = DATE_RE.test(anchorParam) && anchorParam <= today ? anchorParam : today
  let from: string
  let to: string
  if (period === "custom") {
    from = DATE_RE.test(param(sp, "from")) ? param(sp, "from") : today
    to = DATE_RE.test(param(sp, "to")) ? param(sp, "to") : today
    if (to < from) to = from
  } else if (period === "weekly") {
    from = weekStart(anchor)
    to = addDays(from, 6)
  } else if (period === "monthly") {
    from = monthStart(anchor)
    to = monthEnd(anchor)
  } else if (period === "yearly") {
    from = `${anchor.slice(0, 4)}-01-01`
    to = `${anchor.slice(0, 4)}-12-31`
  } else {
    from = anchor
    to = anchor
  }
  if (period !== "custom" && to > today) to = today
  const label =
    period === "daily"
      ? formatDay(from)
      : period === "monthly"
        ? `${new Date(`${from}T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}${to < monthEnd(from) ? ` (to ${formatDay(to)})` : ""}`
        : period === "yearly"
          ? `${from.slice(0, 4)}${to < `${from.slice(0, 4)}-12-31` ? ` (to ${formatDay(to)})` : ""}`
          : `${formatDay(from)} – ${formatDay(to)}`
  return { period, anchor, from, to, today, label }
}

export interface UnifiedRow {
  key: string
  brand: string
  campaign: string
  intern: string
  type: string
  metrics: Record<UnifiedMetric, number>
  completion: number | null
}

/** Submitted ÷ assigned target, as a percentage (null when nothing was assigned). */
export function completionRate(submitted: number, target: number) {
  return target > 0 ? Math.round((submitted / target) * 1000) / 10 : null
}

function toMetrics(r: Pick<ReportRow, "target" | "submitted" | "client_approved" | "published" | "verified_live" | "rejected">, awaiting: number): Record<UnifiedMetric, number> {
  return { target: r.target, submitted: r.submitted, client_approved: r.client_approved, published: r.published, verified_live: r.verified_live, rejected: r.rejected, awaiting }
}

export async function unifiedReport(supabase: SupabaseClient, sp: SearchParams, timeZone: string) {
  const lookups = await getLookups(supabase)
  const labels = labelMaps(lookups)
  const filters: ReportFilters = readFilters(sp)
  const range = resolveReportPeriod(sp, timeZone)
  const group: ReportGroup = param(sp, "group") in REPORT_GROUPS ? (param(sp, "group") as ReportGroup) : "campaign"
  const statusKey = param(sp, "status") in REPORT_STATUSES ? (param(sp, "status") as ReportStatusFilter) : null
  const dims: Dimension[] = [...REPORT_GROUPS[group].dims]

  const data = await loadReportData(supabase, { from: range.from, to: range.to, timeZone, filters })
  let { events, submissions } = data
  if (statusKey) {
    // Restrict to submissions whose current stage matches (same brand / campaign / member / type filters).
    const ids = new Set(
      (
        await fetchAll<{ id: string }>((a, b) => {
          let q = supabase.from("backlink_submissions").select("id").in("status", [...REPORT_STATUSES[statusKey].statuses])
          if (filters.client) q = q.eq("client_id", filters.client)
          if (filters.campaign) q = q.eq("campaign_id", filters.campaign)
          if (filters.intern) q = q.eq("intern_id", filters.intern)
          if (filters.type) q = q.eq("backlink_type_id", filters.type)
          if (filters.keyword) q = q.eq("keyword_id", filters.keyword)
          return q.order("id").range(a, b)
        })
      ).map((r) => r.id),
    )
    events = events.filter((e) => ids.has(e.submission_id))
    submissions = submissions.filter((s) => ids.has(s.id))
  }
  const base = { from: range.from, to: range.to, timeZone, groupBy: dims, labels }
  const report = buildReport({ ...base, events, tasks: data.tasks, submissions })
  // Same grouping over only the not-yet-decided submissions: its "pending" is "Pending approvals".
  const awaitingReport = buildReport({ ...base, events: [], submissions: submissions.filter((s) => AWAITING_APPROVAL.includes(s.status)) })
  const awaitingByKey = new Map(awaitingReport.rows.map((r) => [r.key, r.pending]))

  const all = "All"
  const rows: UnifiedRow[] = report.rows.map((r) => {
    const metrics = toMetrics(r, awaitingByKey.get(r.key) ?? 0)
    return {
      key: r.key,
      brand: r.dims.client?.label ?? all,
      campaign: r.dims.campaign?.label ?? all,
      intern: r.dims.intern?.label ?? all,
      type: r.dims.backlink_type?.label ?? all,
      metrics,
      completion: completionRate(metrics.submitted, metrics.target),
    }
  })
  const totals = toMetrics(report.totals, awaitingReport.totals.pending)
  const matrix = pivot({
    events,
    metric: "submitted",
    rowDim: "campaign",
    colDim: "backlink_type",
    from: range.from,
    to: range.to,
    timeZone,
    labels,
    includeRows: lookups.campaigns
      .filter((c) => c.status === "active" && (!filters.client || c.client_id === filters.client) && (!filters.campaign || c.id === filters.campaign))
      .map((c) => c.id),
  })
  return { lookups, labels, filters, range, group, statusKey, timeZone, rows, totals, completion: completionRate(totals.submitted, totals.target), matrix }
}
export type UnifiedReport = Awaited<ReturnType<typeof unifiedReport>>

/** Human summary of the active filters (for titles, exports and snapshots). */
export function filterSummary(ctx: Pick<UnifiedReport, "filters" | "statusKey" | "lookups">) {
  const { filters: f, lookups: l } = ctx
  const name = <T extends { id: string }>(list: T[], id: string, get: (x: T) => string) => {
    const hit = id ? list.find((x) => x.id === id) : undefined
    return hit ? get(hit) : null
  }
  return [
    name(l.clients, f.client, (c) => c.company_name),
    name(l.campaigns, f.campaign, (c) => `${c.code} · ${c.name}`),
    name(l.interns, f.intern, (i) => i.full_name || i.email),
    name(l.types, f.type, (t) => t.name),
    ctx.statusKey ? REPORT_STATUSES[ctx.statusKey].label : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

export function unifiedToExport(ctx: UnifiedReport, title: string): ExportDoc {
  const { range, group, rows, totals, matrix, timeZone } = ctx
  const extra = group === "backlink_type" ? [{ key: "type", header: "Backlink Type" }] : []
  const note = filterSummary(ctx)
  return {
    title,
    subtitle: `${REPORT_PERIODS[range.period]} · ${range.label} · time zone ${timeZone}${note ? ` · ${note}` : ""} · counts are first-occurrence events (no double counting)`,
    sheets: [
      {
        name: `By ${REPORT_GROUPS[group].label}`,
        columns: [
          { key: "period", header: "Report Period" },
          { key: "brand", header: "Brand" },
          { key: "campaign", header: "Campaign" },
          { key: "intern", header: "Team Member" },
          ...extra,
          ...UNIFIED_METRICS.map((m) => ({ key: m, header: UNIFIED_LABEL[m], numeric: true })),
          { key: "completion", header: "Completion %", numeric: true },
        ],
        rows: rows.map((r) => ({ period: range.label, brand: r.brand, campaign: r.campaign, intern: r.intern, type: r.type, ...r.metrics, completion: r.completion })),
        footer: { period: "Total", ...totals, completion: ctx.completion },
      },
      {
        name: "Submitted by type",
        columns: [
          { key: "campaign", header: "Campaign" },
          ...matrix.columns.map((c) => ({ key: c.id, header: c.label, numeric: true })),
          { key: "total", header: "Total Submitted", numeric: true },
        ],
        rows: matrix.rows.map((r) => ({ campaign: r.label, ...r.cells, total: r.total })),
        footer: { campaign: "Total", ...matrix.columnTotals, total: matrix.total },
      },
    ],
  }
}

