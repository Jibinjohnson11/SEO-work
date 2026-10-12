import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { must } from "@/lib/actions"

/** Keywords are unique per client, case-insensitively. */
export async function findOrCreateKeyword(supabase: SupabaseClient, clientId: string, keyword: string, targetUrl: string | null) {
  const escaped = keyword.replace(/[\\%_]/g, (c) => `\\${c}`)
  const found = await supabase.from("keywords").select("id").eq("client_id", clientId).ilike("keyword", escaped).maybeSingle()
  if (found.data) return found.data as { id: string }
  return must(await supabase.from("keywords").insert({ client_id: clientId, keyword, target_url: targetUrl }).select("id").single()) as { id: string }
}

