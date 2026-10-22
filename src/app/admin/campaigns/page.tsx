import { Plus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { FilterBar } from "@/components/shared/filter-bar"
import { CampaignFormButton } from "@/components/admin/campaign-form"
import { CampaignGrid } from "@/components/admin/campaign-grid"
import { ImportDialog } from "@/components/admin/import-dialog"
import { buildReport, monthStart, todayIn } from "@/lib/reporting"
import { importCampaigns } from "@/server/admin/campaigns"
import { getCampaignFormOptions } from "@/server/campaign-options"
import { fetchAll, getPresets, getSetting, param, type SearchParams } from "@/server/queries"
import { loadReportData } from "@/server/report-data"
import type { Campaign } from "@/lib/types"

export const metadata = { title: "Campaigns" }

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
  const [{ data }, options, kw, assignments, types, published, presets, month] = await Promise.all([
    q,
    getCampaignFormOptions(supabase),
    supabase.from("campaign_keywords").select("campaign_id, is_primary, keywords(keyword)"),
    supabase.from("intern_assignments").select("campaign_id, intern_id").eq("is_active", true),
    supabase.from("campaign_backlink_types").select("campaign_id, backlink_type_id"),
    // One row per published placement (any live status), paged so counts stay exact past 1,000 rows.
    fetchAll<{ campaign_id: string }>((a, b) => supabase.from("published_backlinks").select("campaign_id").order("id").range(a, b)),
    getPresets(supabase, "/admin/campaigns"),
    loadReportData(supabase, { from: monthStart(today), to: today, timeZone: tz, filters: {} }),
  ])
  const campaigns = (data ?? []) as (Campaign & { clients: { company_name: string } })[]
  const perCampaign = new Map(
    buildReport({ ...month, from: monthStart(today), to: today, timeZone: tz, groupBy: ["campaign"] }).rows.map((r) => [r.dims.campaign!.id, r]),
  )
  const keywordsOf = (id: string) => ((kw.data ?? []) as unknown as { campaign_id: string; is_primary: boolean; keywords: { keyword: string } }[]).filter((k) => k.campaign_id === id)
  const internIds = (id: string) => (assignments.data ?? []).filter((a) => a.campaign_id === id).map((a) => a.intern_id as string)
  const publishedCount = published.reduce((m, p) => m.set(p.campaign_id, (m.get(p.campaign_id) ?? 0) + 1), new Map<string, number>())

  return (
    <>
      <PageHeader
        title="Campaigns"
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
      <CampaignGrid
        options={options}
        filters={
          <FilterBar
            presets={presets}
            filters={[
              { type: "select", key: "client", label: "Brand", options: options.clients.map((c) => ({ value: c.id, label: c.label })) },
              { type: "select", key: "status", label: "Status", allLabel: "All except archived", options: ["draft", "active", "paused", "completed", "archived"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
              { type: "select", key: "priority", label: "Priority", options: ["urgent", "high", "medium", "low"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
            ]}
          />
        }
        campaigns={campaigns.map((c) => {
          const kws = keywordsOf(c.id)
          const interns = internIds(c.id)
          const r = perCampaign.get(c.id)
          return {
            campaign: c,
            brand: c.clients.company_name,
            relations: {
              primary_keyword: kws.find((k) => k.is_primary)?.keywords.keyword ?? "",
              secondary_keywords: kws.filter((k) => !k.is_primary).map((k) => k.keywords.keyword),
              intern_ids: interns,
              backlink_type_ids: (types.data ?? []).filter((t) => t.campaign_id === c.id).map((t) => t.backlink_type_id as string),
            },
            published: publishedCount.get(c.id) ?? 0,
            verifiedLiveMonth: r?.verified_live ?? 0,
            submittedMonth: r?.submitted ?? 0,
          }
        })}
        empty={{ title: "No campaigns", description: "Create campaigns manually or import them from CSV / Excel." }}
      />
    </>
  )
}
