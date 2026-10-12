import Link from "next/link"
import { Download } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { ProgressBar } from "@/components/shared/stat-card"
import { CategoryBarChart } from "@/components/charts/charts"
import { formatDay } from "@/lib/format"
import { getLookups, getSetting, resolvePeriod, type SearchParams } from "@/server/queries"
import { internMetrics } from "@/server/intern-metrics"

export const metadata = { title: "Intern Performance" }

export default async function InternPerformance({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports] = await Promise.all([getLookups(supabase), getSetting("reports")])
  const tz = reports.timezone
  const period = resolvePeriod(sp, tz, "this_month")
  const metrics = await internMetrics(supabase, { from: period.from, to: period.to, timeZone: tz })
  const interns = lookups.interns.filter((i) => i.status !== "disabled" || metrics.has(i.id))
  const name = (id: string) => { const i = lookups.interns.find((x) => x.id === id); return i?.full_name || i?.email || "Unknown" }
  const chart = interns.flatMap((i) => {
    const m = metrics.get(i.id)
    return m ? [{ name: name(i.id), target: m.target, submitted: m.submitted, client_approved: m.client_approved, verified_live: m.verified_live }] : []
  })
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()
  const range = period.from === period.to ? formatDay(period.from) : `${formatDay(period.from)} – ${formatDay(period.to)}`

  return (
    <>
      <PageHeader
        title="Intern Performance"
        description={`${range} · ${tz} · measured on approved and verified outcomes, not only volume`}
        actions={<span className="flex gap-2">{["xlsx", "csv", "pdf"].map((f) => <a key={f} href={`/api/analytics/interns?${query}&format=${f}`} className="inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[0.8rem] font-medium hover:bg-muted"><Download className="size-3.5" /> {f.toUpperCase()}</a>)}</span>}
      />
      <FilterBar defaultPeriod="this_month" filters={[{ type: "period" }]} />
      <CategoryBarChart title="Intern comparison" layout="horizontal" categoryLabel="Intern" data={chart} series={[{ key: "target", label: "Assigned target", slot: "reference" }, { key: "submitted", label: "Submitted", slot: 1 }, { key: "client_approved", label: "Client approved", slot: 3 }, { key: "verified_live", label: "Verified live", slot: 6 }]} />
      <DataTable
        searchPlaceholder="Search interns…"
        columns={[
          { key: "name", header: "Intern", sortable: true },
          { key: "tasks", header: "Tasks (done/assigned)", sortable: true, align: "right" },
          { key: "opp", header: "Opportunities", sortable: true, align: "right" },
          { key: "drafts", header: "Content drafts", sortable: true, align: "right" },
          { key: "internal", header: "Int. approved", sortable: true, align: "right" },
          { key: "client", header: "Client approved", sortable: true, align: "right" },
          { key: "published", header: "Published", sortable: true, align: "right" },
          { key: "live", header: "Verified live", sortable: true, align: "right" },
          { key: "rejected", header: "Rejected", sortable: true, align: "right" },
          { key: "revision", header: "Revision rate", sortable: true, align: "right" },
          { key: "completion", header: "Target completion", sortable: true, className: "w-40" },
        ]}
        rows={interns.map((i) => {
          const m = metrics.get(i.id)
          return {
            id: i.id,
            search: name(i.id),
            sort: { name: name(i.id), tasks: m?.tasks_completed ?? 0, opp: m?.opportunities ?? 0, drafts: m?.content_drafts ?? 0, internal: m?.internally_approved ?? 0, client: m?.client_approved ?? 0, published: m?.published ?? 0, live: m?.verified_live ?? 0, rejected: m?.rejected ?? 0, revision: m?.revision_rate ?? 0, completion: m?.target_completion ?? 0 },
            cells: {
              name: <Link href={`/admin/interns/${i.id}`} className="font-medium hover:text-primary">{name(i.id)}</Link>,
              tasks: `${m?.tasks_completed ?? 0} / ${m?.tasks_assigned ?? 0}`,
              opp: m?.opportunities ?? 0, drafts: m?.content_drafts ?? 0, internal: m?.internally_approved ?? 0, client: m?.client_approved ?? 0, published: m?.published ?? 0, live: m?.verified_live ?? 0, rejected: m?.rejected ?? 0,
              revision: `${m?.revision_rate ?? 0}%`,
              completion: <ProgressBar value={m?.submitted ?? 0} max={m?.target ?? 0} />,
            },
          }
        })}
        empty={{ title: "No interns" }}
      />
    </>
  )
}
