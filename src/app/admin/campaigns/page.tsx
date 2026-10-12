import Link from "next/link"
import { Plus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { CampaignStatusBadge, PriorityBadge } from "@/components/shared/status-badge"
import { ProgressBar } from "@/components/shared/stat-card"
import { CampaignFormButton } from "@/components/admin/campaign-form"
import { CampaignRowActions } from "@/components/admin/campaign-actions"
import { ImportDialog } from "@/components/admin/import-dialog"
import { buildReport, monthStart, todayIn } from "@/lib/reporting"
import { formatDay } from "@/lib/format"
import { importCampaigns } from "@/server/admin/campaigns"
import { getCampaignFormOptions } from "@/server/campaign-options"
import { getPresets, getSetting, param, type SearchParams } from "@/server/queries"
import { loadReportData } from "@/server/report-data"
import type { Campaign } from "@/lib/types"

export const metadata = { title: "Campaigns" }
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 }

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const status = param(sp, "status")
  const client = param(sp, "client")
  const priority = param(sp, "priority")
  let q = supabase.from("campaigns").select("*, clients(company_name)").order("code")
  if (status) q = q.eq("status", status)
  else q = q.neq("status", "archived")
  if (/^[0-9a-f-]{36}$/.test(client)) q = q.eq("client_id", client)
  if (priority) q = q.eq("priority", priority)

  const reportSettings = await getSetting("reports")
  const tz = reportSettings.timezone
  const today = todayIn(tz)
  const [{ data }, options, kw, assignments, presets, month, general] = await Promise.all([
    q,
    getCampaignFormOptions(supabase),
    supabase.from("campaign_keywords").select("campaign_id, is_primary, keywords(keyword)"),
    supabase.from("intern_assignments").select("campaign_id").eq("is_active", true),
    getPresets(supabase, "/admin/campaigns"),
    loadReportData(supabase, { from: monthStart(today), to: today, timeZone: tz, filters: {} }),
    getSetting("general"),
  ])
  const campaigns = (data ?? []) as (Campaign & { clients: { company_name: string } })[]
  const perCampaign = new Map(
    buildReport({ ...month, from: monthStart(today), to: today, timeZone: tz, groupBy: ["campaign"] }).rows.map((r) => [r.dims.campaign!.id, r]),
  )
  const keywordsOf = (id: string) => ((kw.data ?? []) as unknown as { campaign_id: string; is_primary: boolean; keywords: { keyword: string } }[]).filter((k) => k.campaign_id === id)
  const internCount = (id: string) => (assignments.data ?? []).filter((a) => a.campaign_id === id).length

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="All SEO campaigns across clients. Progress is verified live backlinks this month vs. target."
        actions={
          <>
            <a href="/api/campaigns/export" className="inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[0.8rem] font-medium hover:bg-muted">Export CSV</a>
            <ImportDialog
              title="Import campaigns"
              action={importCampaigns}
              columns={["client", "campaign_name", "primary_keyword", "secondary_keywords", "target_url", "priority", "start_date", "end_date", "monthly_target", "daily_target", "weekly_target", "status", "description", "campaign_code"]}
              example={["CL-001", "Dental implants Kochi", "dental implants kochi", "implant dentist kochi; tooth implant cost", "https://client.com/implants", "high", "2026-10-01", "2026-12-31", "20", "1", "5", "active", "", ""]}
            />
            <CampaignFormButton options={options}>
              <Plus /> New campaign
            </CampaignFormButton>
          </>
        }
      />
      <FilterBar
        presets={presets}
        filters={[
          { type: "select", key: "client", label: "Client", options: options.clients.map((c) => ({ value: c.id, label: c.label })) },
          { type: "select", key: "status", label: "Status", allLabel: "All except archived", options: ["draft", "active", "paused", "completed", "archived"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
          { type: "select", key: "priority", label: "Priority", options: ["urgent", "high", "medium", "low"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
        ]}
      />
      <DataTable
        searchPlaceholder="Search code, name, keyword…"
        columns={[
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "client", header: "Client", sortable: true },
          { key: "keyword", header: "Primary keyword" },
          { key: "priority", header: "Priority", sortable: true },
          { key: "interns", header: "Interns", sortable: true, align: "right" },
          { key: "submitted", header: "Submitted (mo)", sortable: true, align: "right" },
          { key: "progress", header: "Monthly progress", sortable: true, className: "w-44" },
          { key: "deadline", header: "End date", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "actions", header: "", className: "w-10" },
        ]}
        rows={campaigns.map((c) => {
          const kws = keywordsOf(c.id)
          const primary = kws.find((k) => k.is_primary)?.keywords.keyword
          const r = perCampaign.get(c.id)
          return {
            id: c.id,
            search: `${c.code} ${c.name} ${c.clients.company_name} ${kws.map((k) => k.keywords.keyword).join(" ")} ${c.target_url ?? ""}`,
            sort: {
              campaign: c.code,
              client: c.clients.company_name,
              priority: PRIORITY_RANK[c.priority],
              interns: internCount(c.id),
              submitted: r?.submitted ?? 0,
              progress: c.monthly_target ? (r?.verified_live ?? 0) / c.monthly_target : -1,
              deadline: c.end_date,
              status: c.status,
            },
            cells: {
              campaign: (
                <Link href={`/admin/campaigns/${c.id}`} className="group block">
                  <span className="font-medium group-hover:text-primary">{c.code}</span>
                  <span className="block max-w-64 truncate text-xs text-muted-foreground">{c.name}</span>
                </Link>
              ),
              client: c.clients.company_name,
              keyword: primary ? (
                <span className="text-sm">
                  {primary}
                  {kws.length > 1 ? <span className="text-xs text-muted-foreground"> +{kws.length - 1}</span> : null}
                </span>
              ) : null,
              priority: <PriorityBadge priority={c.priority} />,
              interns: internCount(c.id),
              submitted: r?.submitted ?? 0,
              progress: <ProgressBar value={r?.verified_live ?? 0} max={c.monthly_target} />,
              deadline: formatDay(c.end_date, general.date_format),
              status: <CampaignStatusBadge status={c.status} />,
              actions: <CampaignRowActions id={c.id} status={c.status} />,
            },
          }
        })}
        empty={{ title: "No campaigns", description: "Create campaigns manually or import them from CSV / Excel." }}
      />
    </>
  )
}
