import "server-only"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { DataColumn, DataRow } from "@/components/shared/data-table"
import type { FilterDef } from "@/components/shared/filter-bar"
import { SubmissionStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { formatDateTime, timeAgo } from "@/lib/format"
import { SUBMISSION_STATUS, SUBMISSION_STATUSES } from "@/lib/workflow"
import { utcRange } from "@/lib/reporting"
import { fetchAll, param, resolvePeriod, searchTerm, type Lookups, type SearchParams, labelMaps } from "@/server/queries"
import type { Submission, SubmissionStatus } from "@/lib/types"

/** Rows a submission list shows (the API's row cap); exports read every row. */
export const SUBMISSION_LIST_LIMIT = 1000

const uuidParam = (sp: SearchParams, k: string) => (/^[0-9a-f-]{36}$/.test(param(sp, k)) ? param(sp, k) : "")

/** Server-side filtered submission query shared by the admin queues. */
export async function querySubmissions(
  supabase: SupabaseClient,
  sp: SearchParams,
  opts: { statuses?: SubmissionStatus[]; timeZone: string; dateField?: "updated_at" | "first_submitted_at"; all?: boolean },
) {
  // `all` (exports) reads every row in pages; lists show the newest SUBMISSION_LIST_LIMIT.
  if (opts.all) return fetchAll<Submission>((from, to) => submissionQuery(supabase, sp, opts).range(from, to))
  const { data, error } = await submissionQuery(supabase, sp, opts).limit(SUBMISSION_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as Submission[]
}

function submissionQuery(
  supabase: SupabaseClient,
  sp: SearchParams,
  opts: { statuses?: SubmissionStatus[]; timeZone: string; dateField?: "updated_at" | "first_submitted_at" },
) {
  // id breaks ties so pages never skip or repeat rows.
  let q = supabase.from("backlink_submissions").select("*").order("updated_at", { ascending: false }).order("id")
  const status = param(sp, "status")
  if (opts.statuses) q = q.in("status", status && opts.statuses.includes(status as SubmissionStatus) ? [status] : opts.statuses)
  else if (SUBMISSION_STATUSES.includes(status as SubmissionStatus)) q = q.eq("status", status)
  else if (status !== "all") q = q.neq("status", "archived")
  for (const [k, col] of [["client", "client_id"], ["campaign", "campaign_id"], ["intern", "intern_id"], ["type", "backlink_type_id"], ["keyword", "keyword_id"]] as const) {
    const v = uuidParam(sp, k)
    if (v) q = q.eq(col, v)
  }
  if (param(sp, "period") || param(sp, "from")) {
    const p = resolvePeriod(sp, opts.timeZone, "last_30")
    const r = utcRange(p.from, p.to, opts.timeZone)
    const col = opts.dateField ?? "first_submitted_at"
    q = q.gte(col, r.start.toISOString()).lt(col, r.end.toISOString())
  }
  const qtext = searchTerm(param(sp, "q"))
  if (qtext) q = q.or(`code.ilike.%${qtext}%,proposed_website.ilike.%${qtext}%,content_title.ilike.%${qtext}%,anchor_text.ilike.%${qtext}%,placement_url.ilike.%${qtext}%`)
  return q
}

export function submissionFilters(lookups: Lookups, opts: { statuses?: SubmissionStatus[]; withPeriod?: boolean } = {}): FilterDef[] {
  return [
    { type: "search", key: "q", label: "Search", placeholder: "Code, website, title, anchor…" },
    ...(opts.withPeriod === false ? [] : [{ type: "period" as const, label: "Submitted", presets: [{ value: "", label: "Any time" }, ...["today", "yesterday", "last_7", "this_week", "this_month", "last_month", "last_30", "custom"].map((v) => ({ value: v, label: { today: "Today", yesterday: "Yesterday", last_7: "Last 7 days", this_week: "This week", this_month: "This month", last_month: "Last month", last_30: "Last 30 days", custom: "Custom range" }[v]! }))] }]),
    { type: "select", key: "status", label: "Status", allLabel: opts.statuses ? "All in queue" : "All except archived", options: (opts.statuses ?? [...SUBMISSION_STATUSES, "all" as SubmissionStatus]).map((s) => ({ value: s, label: s === ("all" as string) ? "Including archived" : SUBMISSION_STATUS[s].label })) },
    { type: "select", key: "client", label: "Brand", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
    { type: "select", key: "campaign", label: "Campaign", options: lookups.campaigns.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })) },
    { type: "select", key: "intern", label: "Team member", options: lookups.interns.map((i) => ({ value: i.id, label: i.full_name || i.email })) },
    { type: "select", key: "type", label: "Backlink type", options: lookups.types.map((t) => ({ value: t.id, label: t.name })) },
  ]
}

export const SUBMISSION_COLUMNS: DataColumn[] = [
  { key: "code", header: "Submission", sortable: true },
  { key: "campaign", header: "Campaign", sortable: true },
  { key: "type", header: "Type", sortable: true },
  { key: "intern", header: "Team member", sortable: true },
  { key: "version", header: "Ver.", sortable: true, align: "right" },
  { key: "submitted", header: "Submitted", sortable: true },
  { key: "updated", header: "Last update", sortable: true },
  { key: "status", header: "Status", sortable: true },
]

export function submissionRows(subs: Submission[], lookups: Lookups, timeZone: string, hrefBase = "/admin/submissions"): DataRow[] {
  const labels = labelMaps(lookups)
  return subs.map((s) => ({
    id: s.id,
    href: `${hrefBase}/${s.id}`,
    search: `${s.code} ${s.proposed_website} ${s.content_title ?? ""} ${s.anchor_text ?? ""} ${labels.campaign[s.campaign_id] ?? ""} ${labels.intern[s.intern_id] ?? ""}`,
    sort: { code: s.code, campaign: labels.campaign[s.campaign_id], type: labels.backlink_type[s.backlink_type_id], intern: labels.intern[s.intern_id], version: s.current_version, submitted: s.first_submitted_at, updated: s.updated_at, status: s.status },
    cells: {
      code: (
        <Link href={`${hrefBase}/${s.id}`} className="group block max-w-72">
          <span className="font-medium group-hover:text-primary">{s.code}</span>
          <span className="block truncate text-xs text-muted-foreground">{s.content_title ?? s.proposed_domain}</span>
        </Link>
      ),
      campaign: <span className="text-sm">{labels.campaign[s.campaign_id]}<span className="block text-xs text-muted-foreground">{labels.client[s.client_id]}</span></span>,
      type: labels.backlink_type[s.backlink_type_id],
      intern: labels.intern[s.intern_id],
      version: s.current_version || "—",
      submitted: formatDateTime(s.first_submitted_at, timeZone),
      updated: <span title={formatDateTime(s.updated_at, timeZone)}>{timeAgo(s.updated_at)}</span>,
      status: s.client_approved_version && s.client_approved_version !== s.current_version && s.status === "awaiting_client_approval" ? (
        <span className="flex flex-col gap-1"><SubmissionStatusBadge status={s.status} /><ToneBadge tone="warning">Re-approval</ToneBadge></span>
      ) : <SubmissionStatusBadge status={s.status} />,
    },
  }))
}
