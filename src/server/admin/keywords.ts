"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { blankToNull, keywordSchema, type KeywordInput } from "@/lib/validation"
import { isHttpUrl } from "@/lib/url"
import { parseUpload, splitList } from "@/lib/tabular"
import { findOrCreateKeyword } from "@/server/helpers"
import type { ImportResult } from "@/server/admin/campaigns"

const id = z.string().uuid()

export async function saveKeyword(keywordId: string | null, input: KeywordInput) {
  return run(async () => {
    const { campaign_ids, ...fields } = keywordSchema.parse(input)
    const { supabase } = await authorize(["super_admin"])
    const row = blankToNull(fields)
    let kid = keywordId
    if (kid) must(await supabase.from("keywords").update(row).eq("id", id.parse(kid)))
    else kid = must(await supabase.from("keywords").insert(row).select("id").single()).id as string

    // Sync campaign links but never drop a primary flag silently.
    const { data: links } = await supabase.from("campaign_keywords").select("campaign_id, is_primary").eq("keyword_id", kid)
    const wanted = new Set(campaign_ids)
    const remove = (links ?? []).filter((l) => !wanted.has(l.campaign_id)).map((l) => l.campaign_id)
    if (remove.length) must(await supabase.from("campaign_keywords").delete().eq("keyword_id", kid).in("campaign_id", remove))
    const have = new Set((links ?? []).map((l) => l.campaign_id))
    const add = campaign_ids.filter((c) => !have.has(c))
    if (add.length) must(await supabase.from("campaign_keywords").insert(add.map((c) => ({ campaign_id: c, keyword_id: kid }))))
    revalidatePath("/admin/keywords")
    return kid!
  }, keywordId ? "Keyword updated" : "Keyword added")
}

export async function bulkKeywordAction(
  keywordIds: string[],
  action: { type: "status"; status: "active" | "paused" | "archived" } | { type: "assign"; campaignId: string } | { type: "group"; group: string },
) {
  return run(async () => {
    const ids = z.array(id).min(1).parse(keywordIds)
    const { supabase } = await authorize(["super_admin"])
    if (action.type === "status") must(await supabase.from("keywords").update({ status: action.status }).in("id", ids))
    if (action.type === "group") must(await supabase.from("keywords").update({ group_name: action.group.trim() || null }).in("id", ids))
    if (action.type === "assign")
      must(
        await supabase
          .from("campaign_keywords")
          .upsert(ids.map((k) => ({ campaign_id: id.parse(action.campaignId), keyword_id: k })), { onConflict: "campaign_id,keyword_id", ignoreDuplicates: true }),
      )
    revalidatePath("/admin/keywords")
  }, "Keywords updated")
}

export async function deleteKeyword(keywordId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const { count } = await supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).eq("keyword_id", keywordId)
    if (count) {
      must(await supabase.from("keywords").update({ status: "archived" }).eq("id", id.parse(keywordId)))
      return "archived"
    }
    must(await supabase.from("keywords").delete().eq("id", id.parse(keywordId)))
    revalidatePath("/admin/keywords")
    return "deleted"
  })
}

/** Columns: client, keyword, search_intent, target_url, priority, group, campaign_codes (";"-separated), notes */
export async function importKeywords(formData: FormData) {
  return run<ImportResult>(async () => {
    const { supabase } = await authorize(["super_admin"])
    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to import")
    const rows = await parseUpload(file)
    if (rows.length > 5000) throw new Error("Import at most 5,000 rows at a time")
    const [{ data: clients }, { data: campaigns }] = await Promise.all([
      supabase.from("clients").select("id, code, company_name"),
      supabase.from("campaigns").select("id, code, client_id"),
    ])
    const clientByKey = new Map<string, string>()
    for (const c of clients ?? []) {
      clientByKey.set(c.code.toLowerCase(), c.id)
      clientByKey.set(c.company_name.toLowerCase(), c.id)
    }
    const campaignByCode = new Map((campaigns ?? []).map((c) => [c.code.toLowerCase(), c]))
    const result: ImportResult = { created: 0, updated: 0, errors: [] }
    for (const [i, r] of rows.entries()) {
      try {
        const clientId = clientByKey.get((r.client ?? "").toLowerCase())
        if (!clientId) throw new Error(`Unknown client "${r.client ?? ""}"`)
        if (!r.keyword) throw new Error("keyword is required")
        if (r.target_url && !isHttpUrl(r.target_url)) throw new Error("target_url must be a full http(s) URL")
        const intent = (r.search_intent ?? "").toLowerCase()
        if (intent && !["informational", "navigational", "commercial", "transactional", "local"].includes(intent)) throw new Error(`Invalid search_intent "${r.search_intent}"`)
        const priority = (r.priority || "medium").toLowerCase()
        if (!["low", "medium", "high", "urgent"].includes(priority)) throw new Error(`Invalid priority "${r.priority}"`)
        const kw = await findOrCreateKeyword(supabase, clientId, r.keyword, r.target_url || null)
        must(
          await supabase
            .from("keywords")
            .update({ search_intent: intent || null, target_url: r.target_url || null, priority, group_name: r.group || r.group_name || null, notes: r.notes || null })
            .eq("id", kw.id),
        )
        result.created++
        for (const code of splitList(r.campaign_codes ?? r.campaigns)) {
          const c = campaignByCode.get(code.toLowerCase())
          if (!c || c.client_id !== clientId) throw new Error(`Campaign ${code} not found for this client`)
          must(await supabase.from("campaign_keywords").upsert({ campaign_id: c.id, keyword_id: kw.id }, { onConflict: "campaign_id,keyword_id", ignoreDuplicates: true }))
        }
      } catch (e) {
        result.errors.push({ row: i + 2, message: (e as { message?: string }).message ?? "Failed" })
      }
    }
    revalidatePath("/admin/keywords")
    return result
  })
}
