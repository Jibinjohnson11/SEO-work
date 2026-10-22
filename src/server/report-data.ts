import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { utcRange, type ReportEvent, type SubmissionSnapshot, type TaskTarget } from "@/lib/reporting"
import { fetchAll, param, type SearchParams } from "@/server/queries"

export interface ReportFilters {
  client: string
  campaign: string
  intern: string
  type: string
  keyword: string
}

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
