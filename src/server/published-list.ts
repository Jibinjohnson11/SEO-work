import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { param, type SearchParams } from "@/server/queries"
import type { PublishedBacklink } from "@/lib/types"

export type PublishedRow = PublishedBacklink & { backlink_submissions: { code: string; status: string } }

export async function queryPublished(supabase: SupabaseClient, sp: SearchParams, opts: { liveStatuses?: string[] } = {}) {
  let q = supabase.from("published_backlinks").select("*, backlink_submissions!inner(code, status)").order("publication_date", { ascending: false }).limit(3000)
  for (const [k, col] of [["client", "client_id"], ["campaign", "campaign_id"], ["intern", "intern_id"], ["type", "backlink_type_id"]] as const) {
    const v = param(sp, k)
    if (/^[0-9a-f-]{36}$/.test(v)) q = q.eq(col, v)
  }
  const live = param(sp, "live")
  if (live) q = q.eq("live_status", live)
  else if (opts.liveStatuses) q = q.in("live_status", opts.liveStatuses)
  const text = param(sp, "q").trim().replace(/[%_,()*\\]/g, " ")
  if (text) {
    // PostgREST cannot OR across an embedded table, so resolve matching submission codes first.
    const { data: codes } = await supabase.from("backlink_submissions").select("id").ilike("code", `%${text}%`).limit(200)
    const ids = (codes ?? []).map((c) => c.id)
    q = q.or(
      [`published_url.ilike.%${text}%`, `publisher_domain.ilike.%${text}%`, `anchor_text.ilike.%${text}%`, ...(ids.length ? [`submission_id.in.(${ids.join(",")})`] : [])].join(","),
    )
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as PublishedRow[]
}
