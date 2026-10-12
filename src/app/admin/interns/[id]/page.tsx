import Link from "next/link"
import { notFound } from "next/navigation"
import { requireRole } from "@/lib/auth"
import { DetailList, PageHeader, Section } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { CampaignStatusBadge, SubmissionStatusBadge, TaskStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { DataTable } from "@/components/shared/data-table"
import { InternEditButton, UserMenu } from "@/components/admin/user-actions"
import { CategoryBarChart, TimeSeriesChart } from "@/components/charts/charts"
import { addDays, dailySeries, todayIn, weekStart } from "@/lib/reporting"
import { formatDay, formatDateTime } from "@/lib/format"
import { getLookups, getSetting, labelMaps } from "@/server/queries"
import { internMetrics } from "@/server/intern-metrics"
import { loadReportData } from "@/server/report-data"
import type { Profile, Submission, Task } from "@/lib/types"

export default async function InternDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireRole(["super_admin"])
  const { data } = await supabase.from("profiles").select("*").eq("id", id).eq("role", "intern").maybeSingle()
  if (!data) notFound()
  const p = data as Profile
  const [reports, general, lookups] = await Promise.all([getSetting("reports"), getSetting("general"), getLookups(supabase)])
  const tz = reports.timezone
  const today = todayIn(tz)
  const from = addDays(today, -29)
  const [assign, tasks, subs, m30, mToday, mWeek, activity] = await Promise.all([
    supabase.from("intern_assignments").select("campaign_id, is_active, campaigns(id, code, name, status)").eq("intern_id", id),
    supabase.from("tasks").select("*").eq("intern_id", id).order("due_date", { ascending: true, nullsFirst: false }).limit(200),
    supabase.from("backlink_submissions").select("*").eq("intern_id", id).order("updated_at", { ascending: false }).limit(300),
    internMetrics(supabase, { from, to: today, timeZone: tz, internId: id }),
    internMetrics(supabase, { from: today, to: today, timeZone: tz, internId: id }),
    internMetrics(supabase, { from: weekStart(today), to: today, timeZone: tz, internId: id }),
    loadReportData(supabase, { from, to: today, timeZone: tz, filters: { intern: id } }),
  ])
  const labels = labelMaps(lookups)
  const m = m30.get(id)
  const day = mToday.get(id)
  const week = mWeek.get(id)
  const camps = ((assign.data ?? []) as unknown as { campaign_id: string; is_active: boolean; campaigns: { id: string; code: string; name: string; status: "active" } }[]).filter((a) => a.is_active)
  const taskRows = (tasks.data ?? []) as Task[]
  const submissions = (subs.data ?? []) as Submission[]
  const series = dailySeries(activity.events, from, today, tz)
  const weekly = Object.values(
    series.reduce<Record<string, { name: string; submitted: number; client_approved: number; verified_live: number }>>((acc, d) => {
      const w = weekStart(d.date)
      acc[w] ??= { name: `Wk of ${formatDay(w, "d MMM")}`, submitted: 0, client_approved: 0, verified_live: 0 }
      acc[w].submitted += d.submitted
      acc[w].client_approved += d.client_approved
      acc[w].verified_live += d.verified_live
      return acc
    }, {}),
  )
  const campaignOptions = lookups.campaigns.filter((c) => c.status !== "archived").map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{p.full_name || p.email} <ToneBadge tone={p.status === "active" ? "success" : p.status === "invited" ? "info" : "muted"}>{p.status}</ToneBadge></span>}
        description={`${p.email}${p.job_title ? ` · ${p.job_title}` : ""}`}
        actions={<><InternEditButton profile={p} campaignIds={camps.map((c) => c.campaign_id)} campaigns={campaignOptions} /><UserMenu user={p} /></>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Submitted today" value={day?.submitted ?? 0} hint={`Daily target ${p.daily_target}`} />
        <StatCard label="This week" value={week?.submitted ?? 0} hint={`Weekly target ${p.weekly_target}`} />
        <StatCard label="Open tasks" value={taskRows.filter((t) => !["completed", "cancelled"].includes(t.status)).length} />
        <StatCard label="Pending" value={submissions.filter((s) => ["submitted", "internal_review", "awaiting_client_approval"].includes(s.status)).length} hint="Awaiting review" />
        <StatCard label="Approved (30d)" value={m?.client_approved ?? 0} tone="success" />
        <StatCard label="Published (30d)" value={m?.published ?? 0} />
        <StatCard label="Verified live (30d)" value={m?.verified_live ?? 0} tone="success" />
        <StatCard label="Rejected (30d)" value={m?.rejected ?? 0} tone={m?.rejected ? "danger" : "default"} hint={`Revision rate ${m?.revision_rate ?? 0}%`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <TimeSeriesChart title="Daily activity (30 days)" data={series} series={[{ key: "submitted", label: "Submitted", slot: 1 }, { key: "client_approved", label: "Client approved", slot: 3 }, { key: "verified_live", label: "Verified live", slot: 6 }]} />
        <CategoryBarChart title="Weekly outcomes" data={weekly} layout="horizontal" categoryLabel="Week" series={[{ key: "submitted", label: "Submitted", slot: 1 }, { key: "client_approved", label: "Client approved", slot: 3 }, { key: "verified_live", label: "Verified live", slot: 6 }]} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Profile">
          <DetailList className="sm:grid-cols-1" items={[
            { label: "Joining date", value: formatDay(p.joining_date, general.date_format) },
            { label: "Targets (day / week / month)", value: `${p.daily_target} / ${p.weekly_target} / ${p.monthly_target}` },
            { label: "Tasks completed (30d)", value: `${m?.tasks_completed ?? 0} of ${m?.tasks_assigned ?? 0}` },
            { label: "Content drafts vs opportunities (30d)", value: `${m?.content_drafts ?? 0} / ${m?.opportunities ?? 0}` },
            { label: "Last sign-in", value: formatDateTime(p.last_sign_in_at, tz) },
          ]} />
        </Section>
        <Section title="Assigned campaigns" className="lg:col-span-2" bodyClassName="p-0">
          {camps.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Not assigned to any campaign.</p> : (
            <ul>{camps.map((c) => (
              <li key={c.campaign_id} className="flex items-center justify-between border-b px-4 py-2 text-sm last:border-0">
                <Link className="hover:text-primary" href={`/admin/campaigns/${c.campaign_id}`}>{c.campaigns.code} · {c.campaigns.name}</Link>
                <CampaignStatusBadge status={c.campaigns.status} />
              </li>
            ))}</ul>
          )}
        </Section>
      </div>
      <Section title="Tasks" bodyClassName="p-0" actions={<Link href={`/admin/tasks?intern=${id}`} className="text-xs text-primary hover:underline">Manage tasks</Link>}>
        <DataTable searchPlaceholder={false} pageSize={10} columns={[
          { key: "task", header: "Task", sortable: true }, { key: "campaign", header: "Campaign" }, { key: "target", header: "Target", align: "right" }, { key: "due", header: "Due", sortable: true }, { key: "status", header: "Status", sortable: true },
        ]} rows={taskRows.map((t) => ({ id: t.id, sort: { task: t.code, due: t.due_date, status: t.status }, cells: {
          task: <span>{t.title}<span className="block text-xs text-muted-foreground">{t.code} · {t.backlink_type_id ? labels.backlink_type[t.backlink_type_id] : "Any type"}</span></span>,
          campaign: labels.campaign[t.campaign_id],
          target: `${t.target_quantity} / ${t.cadence.replace("_", "-")}`,
          due: formatDay(t.due_date, general.date_format),
          status: <TaskStatusBadge status={t.status} />,
        } }))} empty={{ title: "No tasks assigned" }} />
      </Section>
      <DataTable caption="Submissions" pageSize={10} columns={[
        { key: "code", header: "Submission", sortable: true }, { key: "campaign", header: "Campaign", sortable: true }, { key: "website", header: "Website" }, { key: "updated", header: "Updated", sortable: true }, { key: "status", header: "Status", sortable: true },
      ]} rows={submissions.map((s) => ({ id: s.id, search: `${s.code} ${s.proposed_website} ${s.content_title ?? ""}`, sort: { code: s.code, campaign: labels.campaign[s.campaign_id], updated: s.updated_at, status: s.status }, cells: {
        code: <Link href={`/admin/submissions/${s.id}`} className="font-medium hover:text-primary">{s.code}</Link>,
        campaign: labels.campaign[s.campaign_id],
        website: <span className="block max-w-56 truncate">{s.proposed_domain}</span>,
        updated: formatDateTime(s.updated_at, tz),
        status: <SubmissionStatusBadge status={s.status} />,
      } }))} empty={{ title: "No submissions yet" }} />
    </>
  )
}
