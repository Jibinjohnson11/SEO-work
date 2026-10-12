import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { CampaignStatusBadge, PriorityBadge } from "@/components/shared/status-badge"
import type { Campaign } from "@/lib/types"

export const metadata = { title: "My Campaigns" }

export default async function InternCampaigns() {
  const { supabase } = await requireRole(["intern"])
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => {
            const keywords = kw.filter((k) => k.campaign_id === c.id)
            return (
              <Link key={c.id} href={`/intern/campaigns/${c.id}`} className="space-y-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{c.code}</span><span className="flex gap-1"><PriorityBadge priority={c.priority} /><CampaignStatusBadge status={c.status} /></span></div>
                <div className="text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.clients.company_name}</div>
                <div className="truncate text-xs text-muted-foreground">{keywords.sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).map((k) => k.keywords.keyword).join(" · ") || "No keywords"}</div>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
