"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { blankToNull, campaignSchema, tristateToDb, type CampaignInput } from "@/lib/validation"
import { isHttpUrl } from "@/lib/url"
import { parseDateCell, parseUpload, splitList } from "@/lib/tabular"
import { findOrCreateKeyword } from "@/server/helpers"

const id = z.string().uuid()

async function syncRelations(
  supabase: SupabaseClient,
  userId: string,
  campaignId: string,
  input: Pick<CampaignInput, "keyword_ids" | "primary_keyword_id" | "intern_ids" | "backlink_type_ids">,
) {
  const keywordIds = [...new Set([...input.keyword_ids, ...(input.primary_keyword_id ? [input.primary_keyword_id] : [])])]
  must(await supabase.from("campaign_keywords").delete().eq("campaign_id", campaignId))
  if (keywordIds.length)
    must(
      await supabase.from("campaign_keywords").insert(
        keywordIds.map((k) => ({ campaign_id: campaignId, keyword_id: k, is_primary: k === input.primary_keyword_id })),
      ),
    )

  must(await supabase.from("campaign_backlink_types").delete().eq("campaign_id", campaignId))
  if (input.backlink_type_ids.length)
    must(
      await supabase
        .from("campaign_backlink_types")
        .insert(input.backlink_type_ids.map((t) => ({ campaign_id: campaignId, backlink_type_id: t }))),
    )

  // Assignments are deactivated rather than deleted so history stays intact.
  const { data: existing } = await supabase.from("intern_assignments").select("intern_id, is_active").eq("campaign_id", campaignId)
  const wanted = new Set(input.intern_ids)
  const toDeactivate = (existing ?? []).filter((a) => a.is_active && !wanted.has(a.intern_id)).map((a) => a.intern_id)
  if (toDeactivate.length)
    must(await supabase.from("intern_assignments").update({ is_active: false }).eq("campaign_id", campaignId).in("intern_id", toDeactivate))
  if (input.intern_ids.length)
    must(
      await supabase.from("intern_assignments").upsert(
        input.intern_ids.map((i) => ({ campaign_id: campaignId, intern_id: i, is_active: true, assigned_by: userId })),
        { onConflict: "campaign_id,intern_id" },
      ),
    )
}

export async function saveCampaign(campaignId: string | null, input: CampaignInput) {
  return run(async () => {
    const parsed = campaignSchema.parse(input)
    const { supabase, userId } = await authorize(["super_admin"])
    const { keyword_ids, primary_keyword_id, intern_ids, backlink_type_ids, ...fields } = parsed
    const row = {
      ...blankToNull(fields),
      is_medical: tristateToDb(fields.is_medical),
      require_internal_review: tristateToDb(fields.require_internal_review),
      require_client_approval: tristateToDb(fields.require_client_approval),
      archived_at: fields.status === "archived" ? new Date().toISOString() : null,
    }
    let cid = campaignId
    if (cid) must(await supabase.from("campaigns").update(row).eq("id", id.parse(cid)))
    else cid = must(await supabase.from("campaigns").insert({ ...row, created_by: userId }).select("id").single()).id as string
    await syncRelations(supabase, userId, cid!, { keyword_ids, primary_keyword_id, intern_ids, backlink_type_ids })
    revalidatePath("/admin/campaigns")
    return cid!
  }, campaignId ? "Campaign updated" : "Campaign created")
}

export async function setCampaignStatus(campaignIds: string[], status: "draft" | "active" | "paused" | "completed" | "archived") {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(
      await supabase
        .from("campaigns")
        .update({ status, archived_at: status === "archived" ? new Date().toISOString() : null })
        .in("id", z.array(id).min(1).parse(campaignIds)),
    )
    revalidatePath("/admin/campaigns")
  }, "Campaign status updated")
}

export async function duplicateCampaign(campaignId: string) {
  return run(async () => {
    const { supabase, userId } = await authorize(["super_admin"])
    const c = must(await supabase.from("campaigns").select("*").eq("id", id.parse(campaignId)).single())
    const [kw, types, interns] = await Promise.all([
      supabase.from("campaign_keywords").select("keyword_id, is_primary").eq("campaign_id", campaignId),
      supabase.from("campaign_backlink_types").select("backlink_type_id").eq("campaign_id", campaignId),
      supabase.from("intern_assignments").select("intern_id").eq("campaign_id", campaignId).eq("is_active", true),
    ])
    const { id: _id, code: _code, created_at: _c, updated_at: _u, archived_at: _a, ...rest } = c
    void _id; void _code; void _c; void _u; void _a
    const copy = must(
      await supabase.from("campaigns").insert({ ...rest, name: `${c.name} (copy)`, status: "draft", created_by: userId }).select("id").single(),
    )
    await syncRelations(supabase, userId, copy.id, {
      keyword_ids: (kw.data ?? []).map((k) => k.keyword_id),
      primary_keyword_id: (kw.data ?? []).find((k) => k.is_primary)?.keyword_id ?? "",
      backlink_type_ids: (types.data ?? []).map((t) => t.backlink_type_id),
      intern_ids: (interns.data ?? []).map((i) => i.intern_id),
    })
    revalidatePath("/admin/campaigns")
    return copy.id as string
  }, "Campaign duplicated as a draft")
}

export interface ImportResult {
  created: number
  updated: number
  errors: { row: number; message: string }[]
}

/**
 * CSV/XLSX columns: client (code or company name), campaign_name, primary_keyword,
 * secondary_keywords (";"-separated), target_url, priority, start_date, end_date,
 * monthly_target, daily_target, weekly_target, status, description, campaign_code (optional, to update).
 */
export async function importCampaigns(formData: FormData) {
  return run<ImportResult>(async () => {
    const { supabase, userId } = await authorize(["super_admin"])
    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to import")
    if (file.size > 5_000_000) throw new Error("File is larger than 5 MB")
    const rows = await parseUpload(file)
    if (rows.length > 2000) throw new Error("Import at most 2,000 rows at a time")

    const { data: clients } = await supabase.from("clients").select("id, code, company_name")
    const clientByKey = new Map<string, string>()
    for (const c of clients ?? []) {
      clientByKey.set(c.code.toLowerCase(), c.id)
      clientByKey.set(c.company_name.toLowerCase(), c.id)
    }
    const result: ImportResult = { created: 0, updated: 0, errors: [] }

    for (const [i, r] of rows.entries()) {
      const rowNo = i + 2
      try {
        const clientId = clientByKey.get((r.client ?? r.client_code ?? r.client_name ?? "").toLowerCase())
        if (!clientId) throw new Error(`Unknown client "${r.client ?? ""}"`)
        const name = r.campaign_name ?? r.name
        if (!name) throw new Error("campaign_name is required")
        const target = r.target_url ?? ""
        if (target && !isHttpUrl(target)) throw new Error("target_url must be a full http(s) URL")
        const start = parseDateCell(r.start_date)
        const end = parseDateCell(r.end_date)
        if (start === "invalid" || end === "invalid") throw new Error("Dates must be YYYY-MM-DD or DD/MM/YYYY")
        const priority = (r.priority || "medium").toLowerCase()
        if (!["low", "medium", "high", "urgent"].includes(priority)) throw new Error(`Invalid priority "${r.priority}"`)
        const status = (r.status || "draft").toLowerCase()
        if (!["draft", "active", "paused", "completed", "archived"].includes(status)) throw new Error(`Invalid status "${r.status}"`)
        const num = (v: string | undefined) => {
          if (!v) return 0
          const n = Number(v)
          if (!Number.isInteger(n) || n < 0) throw new Error(`"${v}" is not a whole number`)
          return n
        }
        const row = {
          name,
          client_id: clientId,
          target_url: target || null,
          priority,
          status,
          start_date: start || null,
          end_date: end || null,
          monthly_target: num(r.monthly_target),
          daily_target: num(r.daily_target),
          weekly_target: num(r.weekly_target),
          description: r.description || null,
        }

        let campaignId: string
        if (r.campaign_code) {
          const existing = await supabase.from("campaigns").select("id").eq("code", r.campaign_code).maybeSingle()
          if (!existing.data) throw new Error(`campaign_code ${r.campaign_code} not found`)
          campaignId = existing.data.id
          must(await supabase.from("campaigns").update(row).eq("id", campaignId))
          result.updated++
        } else {
          campaignId = must(await supabase.from("campaigns").insert({ ...row, created_by: userId }).select("id").single()).id
          result.created++
        }

        const keywordNames = [r.primary_keyword, ...splitList(r.secondary_keywords)].filter(Boolean) as string[]
        for (const [k, kwName] of keywordNames.entries()) {
          const kw = await findOrCreateKeyword(supabase, clientId, kwName, target || null)
          must(
            await supabase
              .from("campaign_keywords")
              .upsert({ campaign_id: campaignId, keyword_id: kw.id, is_primary: k === 0 && Boolean(r.primary_keyword) }, { onConflict: "campaign_id,keyword_id" }),
          )
        }
      } catch (e) {
        result.errors.push({ row: rowNo, message: (e as { message?: string }).message ?? "Failed" })
      }
    }
    revalidatePath("/admin/campaigns")
    return result
  })
}
