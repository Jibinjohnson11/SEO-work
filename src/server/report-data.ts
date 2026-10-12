import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  buildReport,
  DIMENSION_LABEL,
  METRIC_LABEL,
  pivot,
  utcRange,
  type Dimension,
  type ReportEvent,
  type SubmissionSnapshot,
  type TaskTarget,
} from "@/lib/reporting"
import type { ExportDoc } from "@/lib/export"
import { formatDay } from "@/lib/format"
import { fetchAll, getLookups, labelMaps, param, resolvePeriod, type Lookups, type SearchParams } from "@/server/queries"

export interface ReportFilters {
  client: string
  campaign: string
  intern: string
  type: string
  keyword: string
}

export const GROUP_OPTIONS: Exclude<Dimension, never>[] = ["campaign", "intern", "client", "backlink_type", "keyword", "date"]

export function readFilters(sp: SearchParams): ReportFilters {
  const uuid = (v: string) => (/^[0-9a-f-]{36}$/.test(v) ? v : "")
  return {
    client: uuid(param(sp, "client")),
    campaign: uuid(param(sp, "campaign")),
    intern: uuid(param(sp, "intern")),
    type: uuid(param(sp, "type")),
    keyword: uuid(param(sp, "keyword")),
  }
}

/** Loads milestone events, task targets and submission snapshots for a period (RLS applies). */
export async function loadReportData(
  supabase: SupabaseClient,
  { from, to, timeZone, filters }: { from: string; to: string; timeZone: string; filters: Partial<ReportFilters> },
) {
  const { start, end } = utcRange(from, to, timeZone)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apply = (q: any, typeCol = "backlink_type_id") => {
    if (filters.client) q = q.eq("client_id", filters.client)
    if (filters.campaign) q = q.eq("campaign_id", filters.campaign)
    if (filters.intern) q = q.eq("intern_id", filters.intern)
    if (filters.type) q = q.eq(typeCol, filters.type)
    if (filters.keyword) q = q.eq("keyword_id", filters.keyword)
    return q
  }
  const [events, tasks, submissions] = await Promise.all([
    fetchAll<ReportEvent>((a, b) =>
      apply(supabase.from("report_events").select("submission_id, metric, occurred_at, client_id, campaign_id, keyword_id, intern_id, backlink_type_id"))
        .gte("occurred_at", start.toISOString())
        .lt("occurred_at", end.toISOString())
        .order("occurred_at")
        .range(a, b),
    ),
    fetchAll<TaskTarget>((a, b) =>
      apply(supabase.from("tasks").select("id, intern_id, campaign_id, client_id, keyword_id, backlink_type_id, cadence, target_quantity, start_date, due_date, status"))
        .lte("start_date", to)
        .or(`due_date.is.null,due_date.gte.${from}`)
        .neq("status", "cancelled")
        .range(a, b),
    ),
    fetchAll<SubmissionSnapshot>((a, b) =>
      apply(supabase.from("backlink_submissions").select("id, status, first_submitted_at, client_id, campaign_id, keyword_id, intern_id, backlink_type_id"))
        .gte("first_submitted_at", start.toISOString())
        .lt("first_submitted_at", end.toISOString())
        .range(a, b),
    ),
  ])
  return { events, tasks, submissions }
}

export async function reportContext(supabase: SupabaseClient, sp: SearchParams, defaults: { period: "today" | "this_week" | "this_month"; reportTz: string }) {
  const lookups = await getLookups(supabase)
  const filters = readFilters(sp)
  const client = lookups.clients.find((c) => c.id === filters.client)
  // A single-client report uses that client's time zone; otherwise the reporting time zone.
  const timeZone = client?.timezone ?? defaults.reportTz
  const period = resolvePeriod(sp, timeZone, defaults.period)
  const groupBy = (GROUP_OPTIONS as string[]).includes(param(sp, "group")) ? (param(sp, "group") as Dimension) : "campaign"
  const data = await loadReportData(supabase, { from: period.from, to: period.to, timeZone, filters })
  const labels = labelMaps(lookups)
  const report = buildReport({ ...data, from: period.from, to: period.to, timeZone, groupBy: [groupBy], labels })
  const matrix = pivot({
    events: data.events,
    metric: "submitted",
    rowDim: "campaign",
    colDim: "backlink_type",
    from: period.from,
    to: period.to,
    timeZone,
    labels,
    includeRows: lookups.campaigns
      .filter((c) => c.status === "active" && (!filters.client || c.client_id === filters.client) && (!filters.campaign || c.id === filters.campaign))
      .map((c) => c.id),
  })
  return { lookups, filters, timeZone, period, groupBy, data, labels, report, matrix }
}

export const REPORT_COLUMNS = ["target", "submitted", "internally_approved", "client_approved", "published", "verified_live", "rejected", "pending"] as const

export function reportToExport(
  ctx: Pick<Awaited<ReturnType<typeof reportContext>>, "report" | "matrix" | "groupBy" | "period" | "timeZone">,
  title: string,
  lookups?: Lookups,
  filterNote?: string,
): ExportDoc {
  const { report, matrix, groupBy, period, timeZone } = ctx
  void lookups
  const range = period.from === period.to ? formatDay(period.from) : `${formatDay(period.from)} – ${formatDay(period.to)}`
  return {
    title,
    subtitle: `${range} · time zone ${timeZone}${filterNote ? ` · ${filterNote}` : ""} · counts are first-occurrence events (no double counting)`,
    sheets: [
      {
        name: `By ${DIMENSION_LABEL[groupBy]}`,
        columns: [
          { key: "dim", header: DIMENSION_LABEL[groupBy] },
          ...REPORT_COLUMNS.map((m) => ({ key: m, header: METRIC_LABEL[m], numeric: true })),
        ],
        rows: report.rows.map((r) => ({ dim: r.dims[groupBy]?.label ?? "", ...Object.fromEntries(REPORT_COLUMNS.map((m) => [m, r[m]])) })),
        footer: { dim: "Total", ...Object.fromEntries(REPORT_COLUMNS.map((m) => [m, report.totals[m]])) },
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
