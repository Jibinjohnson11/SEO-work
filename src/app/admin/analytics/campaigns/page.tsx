import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { ProgressBar } from "@/components/shared/stat-card"
import { CampaignStatusBadge } from "@/components/shared/status-badge"
import { CategoryBarChart, TimeSeriesChart } from "@/components/charts/charts"
import { buildReport, dailySeries, percent } from "@/lib/reporting"
import { formatDay } from "@/lib/format"
import { getLookups, getSetting, labelMaps, param, resolvePeriod, type SearchParams } from "@/server/queries"
import { loadReportData } from "@/server/report-data"

export const metadata = { title: "Campaign Analytics" }

export default async function CampaignAnalytics({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports] = await Promise.all([getLookups(supabase), getSetting("reports")])
  const client = /^[0-9a-f-]{36}$/.test(param(sp, "client")) ? param(sp, "client") : ""
  const campaign = /^[0-9a-f-]{36}$/.test(param(sp, "campaign")) ? param(sp, "campaign") : ""
  const tz = lookups.clients.find((c) => c.id === client)?.timezone ?? reports.timezone
  const period = resolvePeriod(sp, tz, "this_month")
  const [data, camps, live] = await Promise.all([
    loadReportData(supabase, { from: period.from, to: period.to, timeZone: tz, filters: { client, campaign } }),
    supabase.from("campaigns").select("id, code, name, status, monthly_target, client_id").neq("status", "archived"),
    supabase.from("published_backlinks").select("campaign_id, live_status"),
  ])
  const labels = labelMaps(lookups)
  const rows = buildReport({ ...data, from: period.from, to: period.to, timeZone: tz, groupBy: ["campaign"], labels }).rows
  const byId = new Map(rows.map((r) => [r.dims.campaign!.id, r]))
  const campaigns = (camps.data ?? []).filter((c) => (!client || c.client_id === client) && (!campaign || c.id === campaign))
  const liveCount = (id: string) => (live.data ?? []).filter((p) => p.campaign_id === id && (p.live_status === "live" || p.live_status === "changed")).length
  const range = period.from === period.to ? formatDay(period.from) : `${formatDay(period.from)} – ${formatDay(period.to)}`

  const chart = campaigns
    .map((c) => ({ name: c.code, target: byId.get(c.id)?.target ?? 0, verified: byId.get(c.id)?.verified_live ?? 0 }))
    .filter((c) => c.target || c.verified)
    .sort((a, b) => b.target - a.target)
    .slice(0, 20)

  return (
    <>
      <PageHeader title="Campaign Analytics" description={`${range} · ${tz} · targets come from assigned tasks in the period`} />
      <FilterBar
        defaultPeriod="this_month"
        filters={[
          { type: "period" },
          { type: "select", key: "client", label: "Client", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
          { type: "select", key: "campaign", label: "Campaign", options: lookups.campaigns.filter((c) => !client || c.client_id === client).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })) },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <CategoryBarChart title="Target vs verified live" description="Assigned task targets in period vs. newly verified live backlinks" data={chart} categoryLabel="Campaign" series={[{ key: "target", label: "Target", slot: "reference" }, { key: "verified", label: "Verified live", slot: 1 }]} />
        <TimeSeriesChart title="Activity trend" data={dailySeries(data.events, period.from, period.to, tz)} series={[{ key: "submitted", label: "Submitted", slot: 1 }, { key: "client_approved", label: "Client approved", slot: 3 }, { key: "verified_live", label: "Verified live", slot: 6 }]} />
      </div>
      <DataTable
        searchPlaceholder="Search campaigns…"
        columns={[
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "target", header: "Target", sortable: true, align: "right" },
          { key: "submitted", header: "Submitted", sortable: true, align: "right" },
          { key: "internal", header: "Int. approved", sortable: true, align: "right" },
          { key: "client", header: "Client approved", sortable: true, align: "right" },
          { key: "published", header: "Published", sortable: true, align: "right" },
          { key: "verified", header: "Verified", sortable: true, align: "right" },
          { key: "rejected", header: "Rejected", sortable: true, align: "right" },
          { key: "approval", header: "Approval rate", sortable: true, align: "right" },
          { key: "live", header: "Live now", sortable: true, align: "right" },
          { key: "progress", header: "Verified vs monthly target", className: "w-44" },
        ]}
        rows={campaigns.map((c) => {
          const r = byId.get(c.id)
          return {
            id: c.id,
            search: `${c.code} ${c.name}`,
            sort: { campaign: c.code, status: c.status, target: r?.target ?? 0, submitted: r?.submitted ?? 0, internal: r?.internally_approved ?? 0, client: r?.client_approved ?? 0, published: r?.published ?? 0, verified: r?.verified_live ?? 0, rejected: r?.rejected ?? 0, approval: percent(r?.client_approved ?? 0, r?.submitted ?? 0), live: liveCount(c.id) },
            cells: {
              campaign: <Link href={`/admin/campaigns/${c.id}`} className="hover:text-primary"><span className="font-medium">{c.code}</span><span className="block max-w-56 truncate text-xs text-muted-foreground">{c.name}</span></Link>,
              status: <CampaignStatusBadge status={c.status} />,
              target: r?.target ?? 0, submitted: r?.submitted ?? 0, internal: r?.internally_approved ?? 0, client: r?.client_approved ?? 0, published: r?.published ?? 0, verified: r?.verified_live ?? 0, rejected: r?.rejected ?? 0,
              approval: `${percent(r?.client_approved ?? 0, r?.submitted ?? 0)}%`,
              live: liveCount(c.id),
              progress: <ProgressBar value={r?.verified_live ?? 0} max={c.monthly_target} />,
            },
          }
        })}
        empty={{ title: "No campaigns" }}
      />
    </>
  )
}
