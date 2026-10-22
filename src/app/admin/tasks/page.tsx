import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { PriorityBadge, TaskStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { ProgressBar, StatCard } from "@/components/shared/stat-card"
import { AssignTasksButton, TaskBulkActions, TaskRowMenu, type TaskOptions } from "@/components/admin/task-forms"
import { AlertTriangle, CheckCircle2, ClipboardList, Send, ShieldCheck } from "lucide-react"
import { buildReport, localDate, monthStart, todayIn, weekStart, type ReportRow } from "@/lib/reporting"
import { CADENCE_UNIT } from "@/lib/task-plan"
import { formatDay } from "@/lib/format"
import { TASK_STATUS } from "@/lib/workflow"
import { fetchAll, getLookups, getPresets, getSetting, labelMaps, param, type SearchParams } from "@/server/queries"
import { loadReportData } from "@/server/report-data"
import { assignableMembers } from "@/server/task-members"
import type { Task, TaskStatus } from "@/lib/types"

export const metadata = { title: "Task Management" }

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports, general, presets, kwLinks, typeLinks, members, openTasks] = await Promise.all([
    getLookups(supabase),
    getSetting("reports"),
    getSetting("general"),
    getPresets(supabase, "/admin/tasks"),
    supabase.from("campaign_keywords").select("campaign_id, keyword_id, is_primary"),
    supabase.from("campaign_backlink_types").select("campaign_id, backlink_type_id"),
    assignableMembers(supabase),
    fetchAll<TaskOptions["openTasks"][number] & { due_date: string | null }>((a, b) =>
      supabase.from("tasks").select("intern_id, campaign_id, keyword_id, backlink_type_id, cadence, due_date").not("status", "in", "(completed,cancelled)").range(a, b),
    ),
  ])
  const tz = reports.timezone
  const today = todayIn(tz)
  const labels = labelMaps(lookups)
  const uuid = (k: string) => (/^[0-9a-f-]{36}$/.test(param(sp, k)) ? param(sp, k) : "")
  const status = param(sp, "status")
  let q = supabase.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false }).limit(2000)
  if (uuid("intern")) q = q.eq("intern_id", uuid("intern"))
  if (uuid("campaign")) q = q.eq("campaign_id", uuid("campaign"))
  if (uuid("client")) q = q.eq("client_id", uuid("client"))
  if (uuid("type")) q = q.eq("backlink_type_id", uuid("type"))
  if (status === "overdue") q = q.not("status", "in", "(completed,cancelled)").lt("due_date", today)
  else if (status === "open") q = q.not("status", "in", "(completed,cancelled)")
  else if (status && status in TASK_STATUS) q = q.eq("status", status)
  else if (!status) q = q.not("status", "in", "(completed,cancelled)")
  if (param(sp, "priority")) q = q.eq("priority", param(sp, "priority"))
  const [{ data }, todayData] = await Promise.all([q, loadReportData(supabase, { from: today, to: today, timeZone: tz, filters: {} })])
  const tasks = (data ?? []) as Task[]

  // Today's allocation: targets due today (shared targets are already split per member, so
  // nothing is counted twice) against today's first-time submitted / approved / verified events.
  const todayReport = buildReport({ ...todayData, from: today, to: today, timeZone: tz, groupBy: ["intern", "campaign", "backlink_type"], labels })
  const overdueByMember = new Map<string, number>()
  for (const t of openTasks) if (t.due_date && t.due_date < today) overdueByMember.set(t.intern_id, (overdueByMember.get(t.intern_id) ?? 0) + 1)
  const workload = new Map<string, { id: string; label: string; rows: ReportRow[] }>()
  for (const r of todayReport.rows) {
    if (!(r.target > 0 || r.submitted > 0 || r.internally_approved > 0 || r.verified_live > 0)) continue
    const m = r.dims.intern!
    const entry = workload.get(m.id) ?? { id: m.id, label: m.label, rows: [] }
    entry.rows.push(r)
    workload.set(m.id, entry)
  }
  for (const [id, n] of overdueByMember) if (n && !workload.has(id)) workload.set(id, { id, label: labels.intern[id] ?? "Unknown", rows: [] })
  const sum = (rows: ReportRow[], k: "target" | "submitted" | "internally_approved" | "verified_live") => rows.reduce((a, r) => a + r[k], 0)
  const overdueTotal = [...overdueByMember.values()].reduce((a, b) => a + b, 0)

  // Progress of each listed task in its current period (today / this week / this month / overall).
  const periodStart = (t: Task) => {
    const p = { daily: today, weekly: weekStart(today), monthly: monthStart(today), one_off: t.start_date }[t.cadence]
    return p > t.start_date ? p : t.start_date
  }
  const done = new Map<string, number>()
  const ids = tasks.filter((t) => !["completed", "cancelled"].includes(t.status)).map((t) => t.id)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const chunks = Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, i * 150 + 150))
  for (const res of await Promise.all(chunks.map((c) => supabase.from("backlink_submissions").select("task_id, first_submitted_at").in("task_id", c).not("first_submitted_at", "is", null)))) {
    for (const s of (res.data ?? []) as { task_id: string; first_submitted_at: string }[]) {
      const t = byId.get(s.task_id)
      if (t && localDate(s.first_submitted_at, tz) >= periodStart(t)) done.set(t.id, (done.get(t.id) ?? 0) + 1)
    }
  }

  const kwCampaigns = new Map<string, { id: string; primary: boolean }[]>()
  for (const l of kwLinks.data ?? []) kwCampaigns.set(l.keyword_id, [...(kwCampaigns.get(l.keyword_id) ?? []), { id: l.campaign_id, primary: l.is_primary }])
  const campaignTypes = new Map<string, string[]>()
  for (const l of typeLinks.data ?? []) campaignTypes.set(l.campaign_id, [...(campaignTypes.get(l.campaign_id) ?? []), l.backlink_type_id])
  // Team members can only submit for active campaigns, so work is only assigned there (enforced in the database too).
  const workable = lookups.campaigns.filter((c) => c.status === "active")
  const options: TaskOptions = {
    brands: lookups.clients.filter((c) => c.status === "active" && workable.some((w) => w.client_id === c.id)).map((c) => ({ id: c.id, label: c.company_name })),
    campaigns: workable.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}`, client_id: c.client_id, type_ids: campaignTypes.get(c.id) ?? [] })),
    keywords: lookups.keywords.filter((k) => k.status === "active").map((k) => ({ id: k.id, keyword: k.keyword, campaigns: kwCampaigns.get(k.id) ?? [] })),
    interns: members,
    memberLabels: labels.intern,
    types: lookups.types.filter((t) => t.is_active),
    openTasks: openTasks.map(({ intern_id, campaign_id, keyword_id, backlink_type_id, cadence }) => ({ intern_id, campaign_id, keyword_id, backlink_type_id, cadence })),
    today,
  }
  const overdue = (t: Task) => t.due_date && t.due_date < today && !["completed", "cancelled"].includes(t.status)
  const cell = "px-4 py-2"
  const num = `tabular ${cell} text-right`

  return (
    <>
      <PageHeader title="Task Management" description={`Assign backlink work by brand, campaign and keyword · today is ${formatDay(today, general.date_format)} (${tz})`} actions={<AssignTasksButton options={options} />} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Assigned today" value={todayReport.totals.target} icon={ClipboardList} />
        <StatCard label="Submitted today" value={todayReport.totals.submitted} icon={Send} hint={todayReport.totals.target ? `${Math.round((todayReport.totals.submitted / todayReport.totals.target) * 100)}% of target` : undefined} />
        <StatCard label="Approved today" value={todayReport.totals.internally_approved} icon={CheckCircle2} tone="success" />
        <StatCard label="Verified today" value={todayReport.totals.verified_live} icon={ShieldCheck} tone="success" />
        <StatCard label="Overdue tasks" value={overdueTotal} icon={AlertTriangle} tone={overdueTotal ? "danger" : "default"} href={overdueTotal ? "/admin/tasks?status=overdue" : undefined} />
      </div>

      <Section title="Today's allocation" description={`Workload per team member for ${formatDay(today, general.date_format)} · counts are first-time events in ${tz}`} bodyClassName="p-0">
        {workload.size === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No targets for today. Assign daily tasks to build the allocation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className={`${cell} text-left font-medium`}>Team member / work</th>
                  <th className={`${cell} text-right font-medium`}>Assigned</th>
                  <th className={`${cell} text-right font-medium`}>Submitted</th>
                  <th className={`${cell} text-right font-medium`}>Approved</th>
                  <th className={`${cell} text-right font-medium`}>Verified</th>
                  <th className={`w-48 ${cell} text-left font-medium`}>Progress</th>
                </tr>
              </thead>
              {[...workload.values()].map((m) => {
                const target = sum(m.rows, "target")
                const submitted = sum(m.rows, "submitted")
                const late = overdueByMember.get(m.id) ?? 0
                return (
                  <tbody key={m.id} className="border-b last:border-0">
                    <tr className="bg-muted/20">
                      <td className={`${cell} font-medium`}>
                        <Link href={`/admin/tasks?intern=${m.id}`} className="hover:text-primary hover:underline">{m.label}</Link>
                        {late ? <Link href={`/admin/tasks?intern=${m.id}&status=overdue`} className="ml-2 align-middle"><ToneBadge tone="danger">{late} overdue</ToneBadge></Link> : null}
                      </td>
                      <td className={`${num} font-medium`}>{target}</td>
                      <td className={`${num} font-medium`}>{submitted}</td>
                      <td className={`${num} font-medium`}>{sum(m.rows, "internally_approved")}</td>
                      <td className={`${num} font-medium`}>{sum(m.rows, "verified_live")}</td>
                      <td className={cell}>{target ? <ProgressBar value={submitted} max={target} /> : <span className="text-xs text-muted-foreground">No target today</span>}</td>
                    </tr>
                    {m.rows.map((r) => (
                      <tr key={r.key} className="text-muted-foreground">
                        <td className={`${cell} pl-8 text-xs`}>{r.dims.campaign?.label} · {r.dims.backlink_type?.id === "—" ? "Any type" : r.dims.backlink_type?.label}</td>
                        <td className={`${num} text-xs`}>{r.target}</td>
                        <td className={`${num} text-xs`}>{r.submitted}</td>
                        <td className={`${num} text-xs`}>{r.internally_approved}</td>
                        <td className={`${num} text-xs`}>{r.verified_live}</td>
                        <td className={cell}>{r.target ? <ProgressBar value={r.submitted} max={r.target} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>
        )}
      </Section>

      <FilterBar
        presets={presets}
        filters={[
          { type: "select", key: "status", label: "Status", allLabel: "Open", options: [{ value: "all", label: "All" }, { value: "overdue", label: "Overdue" }, ...(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => ({ value: s, label: TASK_STATUS[s].label }))] },
          { type: "select", key: "intern", label: "Team member", options: options.interns.map((i) => ({ value: i.id, label: i.label })) },
          { type: "select", key: "client", label: "Brand", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
          { type: "select", key: "campaign", label: "Campaign", options: lookups.campaigns.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })) },
          { type: "select", key: "type", label: "Backlink type", options: lookups.types.map((t) => ({ value: t.id, label: t.name })) },
          { type: "select", key: "priority", label: "Priority", options: ["urgent", "high", "medium", "low"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })) },
        ]}
      />
      <DataTable cards={{ title: "task", badge: "status", actions: "actions" }}
        searchPlaceholder="Search tasks…"
        bulk={<TaskBulkActions interns={options.interns} />}
        columns={[
          { key: "task", header: "Task", sortable: true },
          { key: "intern", header: "Team member", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "scope", header: "Keyword / type" },
          { key: "target", header: "Target", sortable: true, align: "right" },
          { key: "progress", header: "Progress" },
          { key: "due", header: "Due", sortable: true },
          { key: "priority", header: "Priority", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "actions", header: "", className: "w-10" },
        ]}
        rows={tasks.map((t) => ({
          id: t.id,
          search: `${t.code} ${t.title} ${labels.intern[t.intern_id] ?? ""} ${labels.campaign[t.campaign_id] ?? ""}`,
          sort: { task: t.code, intern: labels.intern[t.intern_id], campaign: labels.campaign[t.campaign_id], target: t.target_quantity, due: t.due_date, priority: { urgent: 0, high: 1, medium: 2, low: 3 }[t.priority], status: t.status },
          cells: {
            task: <span className="block max-w-64"><span className="font-medium">{t.title}</span><span className="block text-xs text-muted-foreground">{t.code}</span></span>,
            intern: labels.intern[t.intern_id],
            campaign: labels.campaign[t.campaign_id],
            scope: <span className="text-xs">{t.keyword_id ? labels.keyword[t.keyword_id] : "Any keyword"}<span className="block text-muted-foreground">{t.backlink_type_id ? labels.backlink_type[t.backlink_type_id] : "Any type"}</span></span>,
            target: <span className="tabular">{t.target_quantity}<span className="text-xs text-muted-foreground"> / {CADENCE_UNIT[t.cadence]}</span></span>,
            progress: ["completed", "cancelled"].includes(t.status) ? null : t.start_date > today ? (
              <span className="text-xs text-muted-foreground">Starts {formatDay(t.start_date, general.date_format)}</span>
            ) : (
              <span className="block w-32"><span className="tabular text-xs">{done.get(t.id) ?? 0} / {t.target_quantity} {t.cadence === "one_off" ? "done" : `this ${CADENCE_UNIT[t.cadence]}`}</span><ProgressBar value={done.get(t.id) ?? 0} max={t.target_quantity} /></span>
            ),
            due: overdue(t) ? <ToneBadge tone="danger">{formatDay(t.due_date, general.date_format)}</ToneBadge> : formatDay(t.due_date, general.date_format),
            priority: <PriorityBadge priority={t.priority} />,
            status: <TaskStatusBadge status={t.status} />,
            actions: <TaskRowMenu task={t} options={options} />,
          },
        }))}
        empty={{ title: "No tasks match", description: "Use “Assign work” to give one or many team members a keyword target." }}
      />
    </>
  )
}
