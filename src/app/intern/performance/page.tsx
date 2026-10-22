import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { FilterBar } from "@/components/shared/filter-bar"
import { ProgressBar, StatCard } from "@/components/shared/stat-card"
import { CategoryBarChart, TimeSeriesChart } from "@/components/charts/charts"
import { dailySeries, weekStart } from "@/lib/reporting"
import { formatDay } from "@/lib/format"
import { getSetting, resolvePeriod, type SearchParams } from "@/server/queries"
import { internMetrics } from "@/server/intern-metrics"
import { loadReportData } from "@/server/report-data"

export const metadata = { title: "My Performance" }

export default async function InternPerformanceSelf({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase, profile } = await requireRole(["intern"], "intern.performance")
  const tz = profile.timezone || (await getSetting("reports")).timezone
  const period = resolvePeriod(sp, tz, "last_30")
  const [metrics, data] = await Promise.all([
    internMetrics(supabase, { from: period.from, to: period.to, timeZone: tz, internId: profile.id }),
    loadReportData(supabase, { from: period.from, to: period.to, timeZone: tz, filters: { intern: profile.id } }),
  ])
  const m = metrics.get(profile.id)
  const series = dailySeries(data.events, period.from, period.to, tz)
  const weekly = Object.values(series.reduce<Record<string, { name: string; submitted: number; client_approved: number; verified_live: number }>>((acc, d) => {
    const w = weekStart(d.date)
    acc[w] ??= { name: formatDay(w, "d MMM"), submitted: 0, client_approved: 0, verified_live: 0 }
    acc[w].submitted += d.submitted; acc[w].client_approved += d.client_approved; acc[w].verified_live += d.verified_live
    return acc
  }, {}))
  return (
    <>
      <PageHeader title="My Performance" description="Outcomes count more than volume: approvals and verified live links are what matter." />
      <FilterBar defaultPeriod="last_30" filters={[{ type: "period" }]} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Assigned target" value={m?.target ?? 0} />
        <StatCard label="Submitted" value={m?.submitted ?? 0} />
        <StatCard label="Internally approved" value={m?.internally_approved ?? 0} />
        <StatCard label="Client approved" value={m?.client_approved ?? 0} tone="success" />
        <StatCard label="Published" value={m?.published ?? 0} />
        <StatCard label="Verified live" value={m?.verified_live ?? 0} tone="success" />
        <StatCard label="Rejected" value={m?.rejected ?? 0} tone={m?.rejected ? "danger" : "default"} />
        <StatCard label="Revision rate" value={`${m?.revision_rate ?? 0}%`} />
      </div>
      <div className="surface p-4"><div className="mb-2 text-sm font-medium">Target completion</div><ProgressBar value={m?.submitted ?? 0} max={m?.target ?? 0} /></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <TimeSeriesChart title="Daily" data={series} series={[{ key: "submitted", label: "Submitted", slot: 1 }, { key: "client_approved", label: "Client approved", slot: 3 }, { key: "verified_live", label: "Verified live", slot: 6 }]} />
        <CategoryBarChart title="Weekly" layout="horizontal" categoryLabel="Week of" data={weekly} series={[{ key: "submitted", label: "Submitted", slot: 1 }, { key: "client_approved", label: "Client approved", slot: 3 }, { key: "verified_live", label: "Verified live", slot: 6 }]} />
      </div>
    </>
  )
}
