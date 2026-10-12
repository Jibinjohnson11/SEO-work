import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CampaignFormOptions } from "@/components/admin/campaign-form"
import { getLookups } from "@/server/queries"
import { getSetting } from "@/server/queries"

export async function getCampaignFormOptions(supabase: SupabaseClient): Promise<CampaignFormOptions> {
  const [l, defaults] = await Promise.all([getLookups(supabase), getSetting("campaign_defaults")])
  return {
    clients: l.clients.filter((c) => c.status !== "archived").map((c) => ({ id: c.id, label: c.company_name })),
    keywords: l.keywords.filter((k) => k.status !== "archived"),
    interns: l.interns.filter((i) => i.status !== "disabled").map((i) => ({ id: i.id, label: i.full_name || i.email })),
    types: l.types.filter((t) => t.is_active),
    defaults,
  }
}
