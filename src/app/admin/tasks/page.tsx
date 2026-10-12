import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { PriorityBadge, TaskStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { ProgressBar } from "@/components/shared/stat-card"
import { AssignTasksButton, TaskBulkActions, TaskRowMenu, type TaskOptions } from "@/components/admin/task-forms"
import { buildReport, targetAllocations, todayIn } from "@/lib/reporting"
import { formatDay } from "@/lib/format"
import { TASK_STATUS } from "@/lib/workflow"
import { getLookups, getPresets, getSetting, labelMaps, param, type SearchParams } from "@/server/queries"
import { loadReportData } from "@/server/report-data"
import type { Task, TaskStatus } from "@/lib/types"

export const metadata = { title: "Task Management" }

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports, general, presets, kwLinks] = await Promise.all([
    getLookups(supabase),
    getSetting("reports"),
    getSetting("general"),
    getPresets(supabase, "/admin/tasks"),
    supabase.from("campaign_keywords").select("campaign_id, keyword_id"),
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
  if (status === "open") q = q.not("status", "in", "(completed,cancelled)")
  else if (status && status in TASK_STATUS) q = q.eq("status", status)
  else if (!status) q = q.not("status", "in", "(completed,cancelled)")
  if (param(sp, "priority")) q = q.eq("priority", param(sp, "priority"))
  const [{ data }, todayData] = await Promise.all([q, loadReportData(supabase, { from: today, to: today, timeZone: tz, filters: {} })])
  const tasks = (data ?? []) as Task[]

  // Today's allocation: who should deliver what today and how much has been submitted.
  const todayReport = buildReport({ ...todayData, from: today, to: today, timeZone: tz, groupBy: ["intern", "campaign", "backlink_type"], labels })
  const allocation = todayReport.rows.filter((r) => r.target > 0 || r.submitted > 0)

  const kwCampaigns = new Map<string, string[]>()
  for (const l of kwLinks.data ?? []) kwCampaigns.set(l.keyword_id, [...(kwCampaigns.get(l.keyword_id) ?? []), l.campaign_id])
  const options: TaskOptions = {
    interns: lookups.interns.filter((i) => i.status !== "disabled").map((i) => ({ id: i.id, label: i.full_name || i.email })),
    campaigns: lookups.campaigns.filter((c) => c.status === "active" || c.status === "draft").map((c) => ({ id: c.id, label: `${c.code} · ${c.name}`, client_id: c.client_id })),
    keywords: lookups.keywords.map((k) => ({ id: k.id, keyword: k.keyword, campaign_ids: kwCampaigns.get(k.id) ?? [] })),
    types: lookups.types.filter((t) => t.is_active),
    today,
  }
  const overdue = (t: Task) => t.due_date && t.due_date < today && !["completed", "cancelled"].includes(t.status)

  return (
    <>
      <PageHeader title="Task Management" description={`Assign work by intern, campaign, keyword and backlink type · today is ${formatDay(today, general.date_format)} (${tz})`} actions={<AssignTasksButton options={options} />} />

      <Section title="Today's allocation" description="Targets due today from active tasks vs. submissions made today" bodyClassName="p-0">
        {allocation.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No targets for today. Assign daily tasks to build the allocation table.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr><th className="px-4 py-2 text-left font-medium">Intern</th><th className="px-4 py-2 text-left font-medium">Campaign</th><th className="px-4 py-2 text-left font-medium">Backlink type</th><th className="px-4 py-2 text-right font-medium">Target</th><th className="px-4 py-2 text-right font-medium">Submitted</th><th className="w-48 px-4 py-2 font-medium" /></tr>
              </thead>
              <tbody>
                {allocation.map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="px-4 py-2">{r.dims.intern?.label}</td>
                    <td className="px-4 py-2">{r.dims.campaign?.label}</td>
                    <td className="px-4 py-2">{r.dims.backlink_type?.label}</td>
                    <td className="tabular px-4 py-2 text-right">{r.target}</td>
                    <td className="tabular px-4 py-2 text-right">{r.submitted}</td>
                    <td className="px-4 py-2"><ProgressBar value={r.submitted} max={r.target} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <FilterBar
        presets={presets}
        filters={[
          { type: "select", key: "status", label: "Status", allLabel: "Open", options: [{ value: "all", label: "All" }, ...(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => ({ value: s, label: TASK_STATUS[s].label }))] },
          { type: "select", key: "intern", label: "Intern", options: options.interns.map((i) => ({ value: i.id, label: i.label })) },
          { type: "select", key: "client", label: "Client", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
          { type: "select", key: "campaign", label: "Campaign", options: lookups.campaigns.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })) },
          { type: "select", key: "type", label: "Backlink type", options: lookups.types.map((t) => ({ value: t.id, label: t.name })) },
          { type: "select", key: "priority", label: "Priority", options: ["urgent", "high", "medium", "low"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })) },
        ]}
      />
      <DataTable
        searchPlaceholder="Search tasks…"
        bulk={<TaskBulkActions interns={options.interns} />}
        columns={[
          { key: "task", header: "Task", sortable: true },
          { key: "intern", header: "Intern", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "scope", header: "Keyword / type" },
          { key: "target", header: "Target", sortable: true, align: "right" },
          { key: "period", header: "Due today", align: "right" },
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
            target: <span className="tabular">{t.target_quantity}<span className="text-xs text-muted-foreground"> / {{ one_off: "total", daily: "day", weekly: "week", monthly: "month" }[t.cadence]}</span></span>,
            period: targetAllocations(t, today, today).reduce((a, b) => a + b.quantity, 0) || null,
            due: overdue(t) ? <ToneBadge tone="danger">{formatDay(t.due_date, general.date_format)}</ToneBadge> : formatDay(t.due_date, general.date_format),
            priority: <PriorityBadge priority={t.priority} />,
            status: <TaskStatusBadge status={t.status} />,
            actions: <TaskRowMenu task={t} options={options} />,
          },
        }))}
        empty={{ title: "No tasks match", description: "Use “Assign work” to create tasks for one or many interns and campaigns." }}
      />
    </>
  )
}
