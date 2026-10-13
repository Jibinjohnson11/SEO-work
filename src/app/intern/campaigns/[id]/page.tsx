import { LinkButton } from "@/components/ui/link-button"
import { notFound } from "next/navigation"
import { Plus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { DetailList, PageHeader, Section } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { CampaignStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { buildReport, monthStart, todayIn } from "@/lib/reporting"
import { formatDay } from "@/lib/format"
import { humanize } from "@/lib/workflow"
import { getSetting } from "@/server/queries"
import { loadReportData } from "@/server/report-data"
import type { Campaign } from "@/lib/types"

export default async function InternCampaign({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, profile, permissions } = await requireRole(["intern"], "intern.campaigns")
  const { data } = await supabase.from("campaigns").select("*, clients(company_name, timezone)").eq("id", id).maybeSingle()
  if (!data) notFound()
  const c = data as Campaign & { clients: { company_name: string; timezone: string } }
  const tz = profile.timezone || (await getSetting("reports")).timezone
  const today = todayIn(tz)
  const [kw, allowed, types, mine] = await Promise.all([
    supabase.from("campaign_keywords").select("is_primary, keywords(keyword, target_url, search_intent)").eq("campaign_id", id),
    supabase.from("campaign_backlink_types").select("backlink_type_id").eq("campaign_id", id),
    supabase.from("backlink_types").select("id, name, description, required_fields").eq("is_active", true).order("sort_order"),
    loadReportData(supabase, { from: monthStart(today), to: today, timeZone: tz, filters: { campaign: id, intern: profile.id } }),
  ])
  const t = buildReport({ ...mine, from: monthStart(today), to: today, timeZone: tz, groupBy: [] }).totals
  const allowedIds = (allowed.data ?? []).map((a) => a.backlink_type_id)
  const typeList = (types.data ?? []).filter((x) => !allowedIds.length || allowedIds.includes(x.id))
  const keywords = (kw.data ?? []) as unknown as { is_primary: boolean; keywords: { keyword: string; target_url: string | null; search_intent: string | null } }[]
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{c.code} · {c.name} <CampaignStatusBadge status={c.status} /></span>} description={c.clients.company_name} actions={c.status === "active" && can(permissions, "intern.submissions.manage") ? <LinkButton href={`/intern/submissions/new?campaign=${c.id}`} variant="default"><Plus /> New submission</LinkButton> : null} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="My submissions this month" value={t.submitted} />
        <StatCard label="Client approved" value={t.client_approved} tone="success" />
        <StatCard label="Published" value={t.published} />
        <StatCard label="Verified live" value={t.verified_live} tone="success" />
      </div>
      <Section title="Brief">
        <DetailList items={[
          { label: "Target URL", value: c.target_url ? <a href={c.target_url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{c.target_url}</a> : "—" },
          { label: "Targets (day / week / month)", value: `${c.daily_target} / ${c.weekly_target} / ${c.monthly_target}` },
          { label: "Dates", value: `${formatDay(c.start_date)} → ${formatDay(c.end_date)}` },
          { label: "Description", value: c.description ?? "—" },
        ]} />
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Keywords & target URLs" bodyClassName="p-0">
          <ul>{keywords.map((k) => (
            <li key={k.keywords.keyword} className="border-b px-4 py-2 text-sm last:border-0">
              {k.keywords.keyword} {k.is_primary ? <ToneBadge tone="info">Primary</ToneBadge> : null}
              <span className="block truncate text-xs text-muted-foreground">{k.keywords.target_url ?? c.target_url ?? ""}{k.keywords.search_intent ? ` · ${humanize(k.keywords.search_intent)}` : ""}</span>
            </li>
          ))}{keywords.length === 0 ? <li className="p-4 text-sm text-muted-foreground">No keywords.</li> : null}</ul>
        </Section>
        <Section title="Allowed backlink types" bodyClassName="p-0">
          <ul>{typeList.map((x) => (
            <li key={x.id} className="border-b px-4 py-2 text-sm last:border-0">{x.name}<span className="block text-xs text-muted-foreground">{x.description}{x.required_fields.length ? ` · requires ${x.required_fields.map(humanize).join(", ")}` : ""}</span></li>
          ))}</ul>
        </Section>
      </div>
    </>
  )
}
