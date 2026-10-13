import { requireRole } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { PriorityBadge, TaskStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { InternTaskButtons } from "@/components/intern/task-buttons"
import { todayIn } from "@/lib/reporting"
import { formatDay } from "@/lib/format"
import { TASK_STATUS } from "@/lib/workflow"
import { getSetting, param, type SearchParams } from "@/server/queries"
import type { Task, TaskStatus } from "@/lib/types"

export const metadata = { title: "My Tasks" }

export default async function InternTasks({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase, profile, permissions } = await requireRole(["intern"], "intern.tasks")
  const tz = profile.timezone || (await getSetting("reports")).timezone
  const today = todayIn(tz)
  let q = supabase.from("tasks").select("*, campaigns(code, name), keywords(keyword), backlink_types(name)").eq("intern_id", profile.id).order("due_date", { ascending: true, nullsFirst: false })
  const status = param(sp, "status")
  if (status && status in TASK_STATUS) q = q.eq("status", status)
  else if (status !== "all") q = q.not("status", "in", "(completed,cancelled)")
  const { data } = await q
  const tasks = (data ?? []) as (Task & { campaigns: { code: string; name: string }; keywords: { keyword: string } | null; backlink_types: { name: string } | null })[]
  return (
    <>
      <PageHeader title="My Tasks" description="Assigned by your manager. Targets are per period (day, week or month) unless the task is one-off." />
      <FilterBar filters={[{ type: "select", key: "status", label: "Status", allLabel: "Open", options: [{ value: "all", label: "All" }, ...(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => ({ value: s, label: TASK_STATUS[s].label }))] }]} />
      <DataTable
        columns={[
          { key: "task", header: "Task", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "scope", header: "Keyword / type" },
          { key: "target", header: "Target", align: "right" },
          { key: "due", header: "Due", sortable: true },
          { key: "priority", header: "Priority", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "actions", header: "" },
        ]}
        rows={tasks.map((t) => ({
          id: t.id,
          search: `${t.code} ${t.title} ${t.campaigns.code} ${t.campaigns.name}`,
          sort: { task: t.code, campaign: t.campaigns.code, due: t.due_date, priority: { urgent: 0, high: 1, medium: 2, low: 3 }[t.priority], status: t.status },
          cells: {
            task: <span className="block max-w-72"><span className="font-medium">{t.title}</span><span className="block text-xs text-muted-foreground">{t.code}</span>{t.instructions ? <span className="mt-1 block text-xs whitespace-pre-wrap text-muted-foreground">{t.instructions}</span> : null}</span>,
            campaign: <span>{t.campaigns.code}<span className="block text-xs text-muted-foreground">{t.campaigns.name}</span></span>,
            scope: <span className="text-xs">{t.keywords?.keyword ?? "Any keyword"}<span className="block text-muted-foreground">{t.backlink_types?.name ?? "Any allowed type"}</span></span>,
            target: `${t.target_quantity} / ${{ one_off: "total", daily: "day", weekly: "week", monthly: "month" }[t.cadence]}`,
            due: t.due_date && t.due_date < today && !["completed", "cancelled"].includes(t.status) ? <ToneBadge tone="danger">{formatDay(t.due_date)}</ToneBadge> : formatDay(t.due_date),
            priority: <PriorityBadge priority={t.priority} />,
            status: <TaskStatusBadge status={t.status} />,
            actions: <InternTaskButtons taskId={t.id} status={t.status} canSubmit={can(permissions, "intern.submissions.manage")} />,
          },
        }))}
        empty={{ title: "No tasks", description: "You have no tasks in this view." }}
      />
    </>
  )
}
