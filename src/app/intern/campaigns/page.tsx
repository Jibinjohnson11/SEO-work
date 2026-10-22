import { requireRole } from "@/lib/auth"
import { CardGrid, EntityCard } from "@/components/shared/card-grid"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { CampaignStatusBadge, PriorityBadge } from "@/components/shared/status-badge"
import type { Campaign } from "@/lib/types"

export const metadata = { title: "My Campaigns" }

export default async function InternCampaigns() {
  const { supabase } = await requireRole(["intern"], "intern.campaigns")
  const [{ data }, links] = await Promise.all([
    supabase.from("campaigns").select("*, clients(company_name)").neq("status", "archived").order("code"),
    supabase.from("campaign_keywords").select("campaign_id, is_primary, keywords(keyword)"),
  ])
  const campaigns = (data ?? []) as (Campaign & { clients: { company_name: string } })[]
  const kw = (links.data ?? []) as unknown as { campaign_id: string; is_primary: boolean; keywords: { keyword: string } }[]
  return (
    <>
      <PageHeader title="My Campaigns" description="Only campaigns you are assigned to are shown." />
      {campaigns.length === 0 ? <EmptyState title="No campaigns assigned yet" /> : (
        <CardGrid>
          {campaigns.map((c) => {
            const keywords = kw.filter((k) => k.campaign_id === c.id).sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
            return (
              <li key={c.id} className="min-w-0">
                <EntityCard
                  title={<span className="block font-semibold">{c.name}</span>}
                  tooltip={c.name}
                  badge={<CampaignStatusBadge status={c.status} />}
                  href={`/intern/campaigns/${c.id}`}
                  footerNote={<PriorityBadge priority={c.priority} />}
                  details={[
                    { label: "Brand", value: c.clients.company_name },
                    { label: "Code", value: c.code },
                    { label: "Primary keyword", value: keywords.find((k) => k.is_primary)?.keywords.keyword ?? "—" },
                    { label: "All keywords", value: <span className="line-clamp-2" title={keywords.map((k) => k.keywords.keyword).join(" · ")}>{keywords.map((k) => k.keywords.keyword).join(" · ") || "No keywords"}</span> },
                  ]}
                />
              </li>
            )
          })}
        </CardGrid>
      )}
    </>
  )
}
