import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildReport, percent } from "@/lib/reporting"
import { fetchAll } from "@/server/queries"
import { loadReportData } from "@/server/report-data"

export interface InternMetrics {
  intern_id: string
  tasks_assigned: number
  tasks_completed: number
  open_tasks: number
  target: number
  submitted: number
  content_drafts: number
  opportunities: number
  internally_approved: number
  client_approved: number
  published: number
  verified_live: number
  rejected: number
  pending: number
  revision_rate: number
  target_completion: number
  approval_rate: number
}

/**
 * Outcome-based intern metrics for a period: targets come from tasks, counts from first-time
 * milestones, revision rate from submissions that needed more than one version.
 */
export async function internMetrics(
  supabase: SupabaseClient,
  { from, to, timeZone, internId }: { from: string; to: string; timeZone: string; internId?: string },
): Promise<Map<string, InternMetrics>> {
  const filters = internId ? { intern: internId } : {}
  const data = await loadReportData(supabase, { from, to, timeZone, filters })
  const report = buildReport({ ...data, from, to, timeZone, groupBy: ["intern"] })
  const submittedIds = [...new Set(data.events.filter((e) => e.metric === "submitted").map((e) => e.submission_id))]
  const details = submittedIds.length
    ? await fetchAll<{ id: string; intern_id: string; current_version: number; content_draft: string | null }>((a, b) =>
        supabase.from("backlink_submissions").select("id, intern_id, current_version, content_draft").in("id", submittedIds.slice(0, 5000)).range(a, b),
      )
    : []
  let tq = supabase.from("tasks").select("id, intern_id, status, start_date, due_date").lte("start_date", to).or(`due_date.is.null,due_date.gte.${from}`)
  if (internId) tq = tq.eq("intern_id", internId)
  const { data: tasks } = await tq

  const out = new Map<string, InternMetrics>()
  const ensure = (id: string) => {
    let m = out.get(id)
    if (!m) {
      m = { intern_id: id, tasks_assigned: 0, tasks_completed: 0, open_tasks: 0, target: 0, submitted: 0, content_drafts: 0, opportunities: 0, internally_approved: 0, client_approved: 0, published: 0, verified_live: 0, rejected: 0, pending: 0, revision_rate: 0, target_completion: 0, approval_rate: 0 }
      out.set(id, m)
    }
    return m
  }
  for (const r of report.rows) {
    const m = ensure(r.dims.intern!.id)
    Object.assign(m, { target: r.target, submitted: r.submitted, internally_approved: r.internally_approved, client_approved: r.client_approved, published: r.published, verified_live: r.verified_live, rejected: r.rejected, pending: r.pending })
  }
  for (const t of tasks ?? []) {
    if (t.status === "cancelled") continue
    const m = ensure(t.intern_id)
    m.tasks_assigned++
    if (t.status === "completed") m.tasks_completed++
    else m.open_tasks++
  }
  const revised = new Map<string, number>()
  for (const d of details) {
    const m = ensure(d.intern_id)
    if (d.content_draft) m.content_drafts++
    else m.opportunities++
    if (d.current_version > 1) revised.set(d.intern_id, (revised.get(d.intern_id) ?? 0) + 1)
  }
  for (const m of out.values()) {
    m.revision_rate = percent(revised.get(m.intern_id) ?? 0, m.submitted)
    m.target_completion = percent(m.submitted, m.target)
    m.approval_rate = percent(m.client_approved + 0, m.submitted)
  }
  return out
}
