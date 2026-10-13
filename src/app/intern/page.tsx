import Link from "next/link"
import { LinkButton } from "@/components/ui/link-button"
import { Plus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { PageHeader, Section } from "@/components/shared/page-header"
import { ProgressBar, StatCard } from "@/components/shared/stat-card"
import { SubmissionStatusBadge, TaskStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { InternTaskButtons } from "@/components/intern/task-buttons"
import { TimeSeriesChart } from "@/components/charts/charts"
import { addDays, dailySeries, targetAllocations, todayIn } from "@/lib/reporting"
import { formatDay, timeAgo } from "@/lib/format"
import { getSetting } from "@/server/queries"
import { internMetrics } from "@/server/intern-metrics"
import { loadReportData } from "@/server/report-data"
import type { Submission, Task } from "@/lib/types"

export const metadata = { title: "My Dashboard" }

export default async function InternHome() {
  const { supabase, profile, permissions } = await requireRole(["intern"], "intern.dashboard")
  const reports = await getSetting("reports")
  const tz = profile.timezone || reports.timezone
  const today = todayIn(tz)
  const from = addDays(today, -13)
  const [tasksRes, returned, mToday, m30, activity, campaigns] = await Promise.all([
    supabase.from("tasks").select("*, campaigns(code)").eq("intern_id", profile.id).not("status", "in", "(completed,cancelled)").order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("backlink_submissions").select("*").eq("intern_id", profile.id).in("status", ["internal_changes_requested", "client_changes_requested", "ready_for_publication", "client_approved", "verification_failed"]).order("updated_at", { ascending: false }),
    internMetrics(supabase, { from: today, to: today, timeZone: tz, internId: profile.id }),
    internMetrics(supabase, { from: addDays(today, -29), to: today, timeZone: tz, internId: profile.id }),
    loadReportData(supabase, { from, to: today, timeZone: tz, filters: { intern: profile.id } }),
    supabase.from("intern_assignments").select("campaign_id").eq("intern_id", profile.id).eq("is_active", true),
  ])
  const tasks = (tasksRes.data ?? []) as (Task & { campaigns: { code: string } })[]
  const day = mToday.get(profile.id)
  const month = m30.get(profile.id)
  const todayTarget = tasks.reduce((a, t) => a + targetAllocations(t, today, today).reduce((x, y) => x + y.quantity, 0), 0) || profile.daily_target
  const { count: pending } = await supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).eq("intern_id", profile.id).in("status", ["submitted", "internal_review", "internally_approved", "awaiting_client_approval"])
  const attention = (returned.data ?? []) as Submission[]

  return (
    <>
      <PageHeader title={`Hello, ${profile.full_name.split(" ")[0] || "there"}`} description={`${formatDay(today)} · ${(campaigns.data ?? []).length} assigned campaigns`} actions={can(permissions, "intern.submissions.manage") ? <LinkButton href="/intern/submissions/new" variant="default"><Plus /> New submission</LinkButton> : null} />
      <Section title="Today's target">
        <div className="flex flex-wrap items-center gap-4">
          <div className="tabular text-3xl font-semibold">{day?.submitted ?? 0}<span className="text-lg text-muted-foreground"> / {todayTarget}</span></div>
          <ProgressBar className="min-w-48 flex-1" value={day?.submitted ?? 0} max={todayTarget} />
        </div>
      </Section>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open tasks" value={tasks.length} href={can(permissions, "intern.tasks") ? "/intern/tasks" : undefined} />
        <StatCard label="Pending reviews" value={pending ?? 0} hint="With reviewer or client" />
        <StatCard label="Client approved (30d)" value={month?.client_approved ?? 0} tone="success" />
        <StatCard label="Verified live (30d)" value={month?.verified_live ?? 0} tone="success" hint={`${month?.published ?? 0} published · ${month?.rejected ?? 0} rejected`} />
      </div>
      {attention.length ? (
        <Section title="Needs your attention" bodyClassName="p-0">
          <ul>
            {attention.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-sm last:border-0">
                {can(permissions, "intern.submissions") ? (
                  <Link href={`/intern/submissions/${s.id}`} className="hover:text-primary"><span className="font-medium">{s.code}</span> · {s.content_title ?? s.proposed_domain}</Link>
                ) : (
                  <span><span className="font-medium">{s.code}</span> · {s.content_title ?? s.proposed_domain}</span>
                )}
                <span className="flex items-center gap-2"><SubmissionStatusBadge status={s.status} /><span className="text-xs text-muted-foreground">{timeAgo(s.updated_at)}</span></span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="My open tasks" bodyClassName="p-0" actions={can(permissions, "intern.tasks") ? <Link href="/intern/tasks" className="text-xs text-primary hover:underline">All tasks</Link> : null}>
        {tasks.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No open tasks. Your manager will assign work here.</p> : (
          <ul>
            {tasks.slice(0, 8).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground">{t.code} · {t.campaigns.code} · {t.target_quantity} per {{ one_off: "task", daily: "day", weekly: "week", monthly: "month" }[t.cadence]}{t.due_date ? ` · due ${formatDay(t.due_date)}` : ""}</div>
                </div>
                {t.due_date && t.due_date < today ? <ToneBadge tone="danger">Overdue</ToneBadge> : null}
                <TaskStatusBadge status={t.status} />
                {can(permissions, "intern.tasks") ? <InternTaskButtons taskId={t.id} status={t.status} canSubmit={can(permissions, "intern.submissions.manage")} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <TimeSeriesChart title="My last 14 days" data={dailySeries(activity.events, from, today, tz)} series={[{ key: "submitted", label: "Submitted", slot: 1 }, { key: "client_approved", label: "Client approved", slot: 3 }, { key: "verified_live", label: "Verified live", slot: 6 }]} />
    </>
  )
}
