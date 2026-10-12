import {
  BadgeCheck,
  Building2,
  ClipboardCheck,
  Globe,
  Megaphone,
  Radar,
  Send,
  Tags,
  Target,
  Users,
  XCircle,
} from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { FilterBar, type FilterDef } from "@/components/shared/filter-bar"
import { CategoryBarChart, TimeSeriesChart } from "@/components/charts/charts"
import {
  buildReport,
  dailySeries,
  monthStart,
  percent,
  todayIn,
  type ReportEvent,
} from "@/lib/reporting"
import { formatDay, formatNumber } from "@/lib/format"
import { SUBMISSION_STATUS, SUBMISSION_STATUSES } from "@/lib/workflow"
import { getLookups, getPresets, getSetting, labelMaps, param, resolvePeriod, type SearchParams } from "@/server/queries"
import { loadReportData, readFilters } from "@/server/report-data"

export const metadata = { title: "Overview" }

export default async function AdminOverview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reportSettings, presets] = await Promise.all([
    getLookups(supabase),
    getSetting("reports"),
    getPresets(supabase, "/admin"),
  ])
  const filters = readFilters(sp)
  const status = SUBMISSION_STATUSES.find((s) => s === param(sp, "status")) ?? ""
  const tz = lookups.clients.find((c) => c.id === filters.client)?.timezone ?? reportSettings.timezone
  const period = resolvePeriod(sp, tz, "last_30")
  const today = todayIn(tz)
  const labels = labelMaps(lookups)

  // Current-state counts (respect client/campaign/intern/type filters).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = (q: any) => {
    let r = q
    if (filters.client) r = r.eq("client_id", filters.client)
    if (filters.campaign) r = r.eq("campaign_id", filters.campaign)
    if (filters.intern) r = r.eq("intern_id", filters.intern)
    if (filters.type) r = r.eq("backlink_type_id", filters.type)
    return r
  }
  const head = { count: "exact" as const, head: true }

  const [
    data,
    monthData,
    keywords,
    pendingReview,
    pendingClient,
    liveNow,
    statusIds,
  ] = await Promise.all([
    loadReportData(supabase, { from: period.from, to: period.to, timeZone: tz, filters }),
    loadReportData(supabase, { from: monthStart(today), to: today, timeZone: tz, filters }),
    filters.client
      ? supabase.from("keywords").select("id", head).eq("client_id", filters.client).neq("status", "archived")
      : supabase.from("keywords").select("id", head).neq("status", "archived"),
    scoped(supabase.from("backlink_submissions").select("id", head)).in("status", ["submitted", "internal_review"]),
    scoped(supabase.from("backlink_submissions").select("id", head)).eq("status", "awaiting_client_approval"),
    scoped(supabase.from("published_backlinks").select("id", head)).in("live_status", ["live", "changed"]),
    status
      ? scoped(supabase.from("backlink_submissions").select("id")).eq("status", status).limit(10000)
      : Promise.resolve({ data: null }),
  ])

  // Optional "current status" filter narrows event-based metrics to those submissions.
  const statusSet = statusIds.data ? new Set((statusIds.data as { id: string }[]).map((r) => r.id)) : null
  const keep = (e: ReportEvent) => !statusSet || statusSet.has(e.submission_id)
  const events = data.events.filter(keep)
  const monthEvents = monthData.events.filter(keep)

  const totals = buildReport({ events, from: period.from, to: period.to, timeZone: tz, groupBy: [] }).totals
  const todayTotals = buildReport({ events, from: today, to: today, timeZone: tz, groupBy: [] }).totals
  const monthTotals = buildReport({ events: monthEvents, from: monthStart(today), to: today, timeZone: tz, groupBy: ["campaign"], labels })

  const clients = lookups.clients.filter((c) => !filters.client || c.id === filters.client)
  const campaigns = lookups.campaigns.filter(
    (c) => (!filters.client || c.client_id === filters.client) && (!filters.campaign || c.id === filters.campaign),
  )
  const activeCampaigns = campaigns.filter((c) => c.status === "active")
  const { data: targets } = await supabase
    .from("campaigns")
    .select("id, code, monthly_target")
    .in("id", activeCampaigns.length ? activeCampaigns.map((c) => c.id) : ["00000000-0000-0000-0000-000000000000"])
  const monthlyTarget = (targets ?? []).reduce((a, c) => a + (c.monthly_target ?? 0), 0)
  const verifiedThisMonth = monthTotals.totals.verified_live

  const series = dailySeries(events, period.from, period.to, tz)
  const byType = buildReport({ events, from: period.from, to: period.to, timeZone: tz, groupBy: ["backlink_type"], labels }).rows
    .filter((r) => r.submitted > 0)
    .map((r) => ({ name: r.dims.backlink_type!.label, submitted: r.submitted }))
    .sort((a, b) => b.submitted - a.submitted)

  const verifiedByCampaign = new Map(monthTotals.rows.map((r) => [r.dims.campaign!.id, r.verified_live]))
  const campaignPerf = (targets ?? [])
    .map((c) => ({ name: c.code, target: c.monthly_target ?? 0, verified: verifiedByCampaign.get(c.id) ?? 0 }))
    .sort((a, b) => b.target - a.target)
    .slice(0, 15)

  const internRows = buildReport({ ...data, events, from: period.from, to: period.to, timeZone: tz, groupBy: ["intern"], labels }).rows
    .filter((r) => r.target || r.submitted)
    .map((r) => ({
      name: r.dims.intern!.label,
      target: r.target,
      submitted: r.submitted,
      client_approved: r.client_approved,
      verified_live: r.verified_live,
    }))
    .slice(0, 15)

  const filterDefs: FilterDef[] = [
    { type: "period" },
    { type: "select", key: "client", label: "Client", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
    {
      type: "select",
      key: "campaign",
      label: "Campaign",
      options: lookups.campaigns.filter((c) => !filters.client || c.client_id === filters.client).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
    },
    { type: "select", key: "intern", label: "Intern", options: lookups.interns.map((i) => ({ value: i.id, label: i.full_name || i.email })) },
    { type: "select", key: "type", label: "Backlink type", options: lookups.types.map((t) => ({ value: t.id, label: t.name })) },
    { type: "select", key: "status", label: "Current status", options: SUBMISSION_STATUSES.map((s) => ({ value: s, label: SUBMISSION_STATUS[s].label })) },
  ]

  const rangeLabel = period.from === period.to ? formatDay(period.from) : `${formatDay(period.from)} – ${formatDay(period.to)}`
  const completion = percent(verifiedThisMonth, monthlyTarget)

  return (
    <>
      <PageHeader title="Overview" description={`Activity for ${rangeLabel} · ${tz}`} />
      <FilterBar filters={filterDefs} presets={presets} defaultPeriod="last_30" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Total Clients" value={formatNumber(clients.length)} icon={Building2} href="/admin/clients" />
        <StatCard label="Active Clients" value={formatNumber(clients.filter((c) => c.status === "active").length)} icon={Building2} href="/admin/clients?status=active" />
        <StatCard label="Total Campaigns" value={formatNumber(campaigns.length)} icon={Megaphone} href="/admin/campaigns" />
        <StatCard label="Active Campaigns" value={formatNumber(activeCampaigns.length)} icon={Megaphone} href="/admin/campaigns?status=active" />
        <StatCard label="Total Keywords" value={formatNumber(keywords.count ?? 0)} icon={Tags} href="/admin/keywords" />
        <StatCard label="Active Interns" value={formatNumber(lookups.interns.filter((i) => i.status === "active").length)} icon={Users} href="/admin/interns" />
        <StatCard label="Submitted Today" value={formatNumber(todayTotals.submitted)} icon={Send} hint={formatDay(today)} href="/admin/reports/daily" />
        <StatCard label="Pending Internal Reviews" value={formatNumber(pendingReview.count ?? 0)} icon={ClipboardCheck} tone={(pendingReview.count ?? 0) > 0 ? "warning" : "default"} href="/admin/review" hint="Current" />
        <StatCard label="Pending Client Approvals" value={formatNumber(pendingClient.count ?? 0)} icon={BadgeCheck} href="/admin/approvals" hint="Current" />
        <StatCard label="Client Approved" value={formatNumber(totals.client_approved)} icon={BadgeCheck} tone="success" hint="In period" />
        <StatCard label="Published Backlinks" value={formatNumber(totals.published)} icon={Globe} hint="In period" href="/admin/published" />
        <StatCard label="Verified Live Backlinks" value={formatNumber(liveNow.count ?? 0)} icon={Radar} tone="success" hint={`${formatNumber(totals.verified_live)} newly verified in period`} href="/admin/verification" />
        <StatCard label="Rejected Submissions" value={formatNumber(totals.rejected)} icon={XCircle} tone={totals.rejected ? "danger" : "default"} hint="In period" />
        <StatCard
          label="Monthly Target Completion"
          value={monthlyTarget ? `${completion}%` : "—"}
          icon={Target}
          tone={completion >= 100 ? "success" : "default"}
          hint={monthlyTarget ? `${verifiedThisMonth} verified of ${monthlyTarget} target` : "No monthly targets set"}
        />
      </div>

      <TimeSeriesChart
        title="Daily backlink activity"
        description="Each submission counted once per milestone, on the date it happened"
        data={series}
        series={[
          { key: "submitted", label: "Submitted", slot: 1 },
          { key: "internally_approved", label: "Internally approved", slot: 2 },
          { key: "client_approved", label: "Client approved", slot: 3 },
          { key: "published", label: "Published", slot: 4 },
          { key: "verified_live", label: "Verified live", slot: 6 },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <CategoryBarChart
          title="Backlink type distribution"
          description="Submissions in period by type"
          data={byType}
          categoryLabel="Backlink type"
          series={[{ key: "submitted", label: "Submitted", slot: 1 }]}
        />
        <CategoryBarChart
          title="Campaign performance"
          description="Monthly target vs. verified live backlinks this month (active campaigns)"
          data={campaignPerf}
          categoryLabel="Campaign"
          series={[
            { key: "target", label: "Monthly target", slot: "reference" },
            { key: "verified", label: "Verified live", slot: 1 },
          ]}
        />
      </div>

      <CategoryBarChart
        title="Intern performance"
        description="Assigned target, submissions, client approvals and verified live backlinks in period"
        data={internRows}
        categoryLabel="Intern"
        layout="horizontal"
        series={[
          { key: "target", label: "Assigned target", slot: "reference" },
          { key: "submitted", label: "Submitted", slot: 1 },
          { key: "client_approved", label: "Client approved", slot: 3 },
          { key: "verified_live", label: "Verified live", slot: 6 },
        ]}
      />
    </>
  )
}
