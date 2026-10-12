import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { InternFormOptions } from "@/components/intern/submission-form"

/** Only campaigns the intern is actively assigned to (RLS enforces this as well). */
export async function getInternFormOptions(supabase: SupabaseClient, userId: string): Promise<InternFormOptions> {
  const [camps, links, allowed, types, tasks] = await Promise.all([
    supabase.from("campaigns").select("id, code, name, target_url, status").eq("status", "active").order("code"),
    supabase.from("campaign_keywords").select("campaign_id, is_primary, keywords(id, keyword, target_url, status)"),
    supabase.from("campaign_backlink_types").select("campaign_id, backlink_type_id"),
    supabase.from("backlink_types").select("id, name, required_fields, description").eq("is_active", true).order("sort_order"),
    supabase.from("tasks").select("id, code, title, campaign_id, keyword_id, backlink_type_id, status").eq("intern_id", userId).not("status", "in", "(completed,cancelled)"),
  ])
  const linkRows = (links.data ?? []) as unknown as { campaign_id: string; is_primary: boolean; keywords: { id: string; keyword: string; target_url: string | null; status: string } }[]
  return {
    campaigns: (camps.data ?? []).map((c) => ({
      id: c.id,
      label: `${c.code} · ${c.name}`,
      target_url: c.target_url,
      type_ids: (allowed.data ?? []).filter((a) => a.campaign_id === c.id).map((a) => a.backlink_type_id),
      keywords: linkRows.filter((l) => l.campaign_id === c.id && l.keywords.status !== "archived").sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).map((l) => l.keywords),
    })),
    types: (types.data ?? []) as InternFormOptions["types"],
    tasks: (tasks.data ?? []).map((t) => ({ id: t.id, label: `${t.code} · ${t.title}`, campaign_id: t.campaign_id, keyword_id: t.keyword_id, backlink_type_id: t.backlink_type_id })),
  }
}
