"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { blankToNull, campaignSchema, newCampaignSchema, tristateToDb, type CampaignInput, type NewCampaignInput } from "@/lib/validation"
import { todayIn } from "@/lib/reporting"
import { isHttpUrl } from "@/lib/url"
import { parseDateCell, parseUpload, splitList } from "@/lib/tabular"
import { findOrCreateKeyword } from "@/server/helpers"

const id = z.string().uuid()

/**
 * Keyword names → keyword ids for one brand, primary first. Names are de-duplicated case-insensitively;
 * existing keyword records of the brand are reused, missing ones are created (never renamed or deleted).
 */
async function resolveKeywords(supabase: SupabaseClient, clientId: string, primary: string, secondary: string[], targetUrl: string | null) {
  const seen = new Set<string>()
  const names = [primary, ...secondary].map((k) => k.trim()).filter((k) => {
    const key = k.toLowerCase()
    if (!k || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const ids: string[] = []
  for (const k of names) ids.push((await findOrCreateKeyword(supabase, clientId, k, targetUrl)).id)
  return { keyword_ids: ids, primary_keyword_id: primary.trim() ? ids[0] : "" }
}

/** Keywords (primary first), allowed backlink types and active team in one database transaction. */
async function syncRelations(
  supabase: SupabaseClient,
  campaignId: string,
  input: { keyword_ids: string[]; primary_keyword_id: string } & Pick<CampaignInput, "intern_ids" | "backlink_type_ids">,
) {
  const keywordIds = [...new Set([...input.keyword_ids, ...(input.primary_keyword_id ? [input.primary_keyword_id] : [])])]
  must(
    await supabase.rpc("campaign_sync_relations", {
      p_campaign_id: campaignId,
      p_keyword_ids: keywordIds,
      p_primary_keyword_id: input.primary_keyword_id || null,
      p_type_ids: [...new Set(input.backlink_type_ids)],
      p_intern_ids: [...new Set(input.intern_ids)],
    }),
  )
}

export async function saveCampaign(campaignId: string | null, input: CampaignInput) {
  return run(async () => {
    const parsed = campaignSchema.parse(input)
    const { supabase, userId } = await authorize(["super_admin"])
    const { primary_keyword, secondary_keywords, intern_ids, backlink_type_ids, ...fields } = parsed
    // The brand of an existing campaign never changes here; keywords belong to that brand.
    const clientId = campaignId
      ? (must(await supabase.from("campaigns").select("client_id").eq("id", id.parse(campaignId)).single()).client_id as string)
      : fields.client_id
    const { client_id: _client, ...editable } = fields
    void _client
    const row = {
      ...blankToNull(editable),
      client_id: clientId,
      is_medical: tristateToDb(fields.is_medical),
      // Internal review follows the medical flag in the database (campaign_flags); no override is stored.
      require_internal_review: null,
      require_client_approval: tristateToDb(fields.require_client_approval),
      archived_at: fields.status === "archived" ? new Date().toISOString() : null,
    }
    let cid = campaignId
    if (cid) must(await supabase.from("campaigns").update(row).eq("id", id.parse(cid)))
    else cid = must(await supabase.from("campaigns").insert({ ...row, created_by: userId }).select("id").single()).id as string
    const keywords = await resolveKeywords(supabase, clientId, primary_keyword, secondary_keywords, fields.target_url || null)
    await syncRelations(supabase, cid!, { ...keywords, intern_ids, backlink_type_ids })
    revalidatePath("/admin/campaigns")
    return cid!
  }, campaignId ? "Campaign updated" : "Campaign created")
}

/**
 * Simplified creation: the campaign is named after its primary keyword, starts today (in the brand's
 * time zone) as Active (or Draft when Active = No) with no targets, deadline, location or team (set later via Edit), and inherits
 * medical / internal review / client approval from the brand (NULL = inherit).
 * Keywords are reused case-insensitively within the brand or created in the Keywords module.
 */
export async function createCampaign(input: NewCampaignInput) {
  return run(async () => {
    const v = newCampaignSchema.parse(input)
    const { supabase, userId } = await authorize(["super_admin"])
    const brand = must(await supabase.from("clients").select("id, status, timezone").eq("id", v.client_id).single())
    if (brand.status === "archived") throw new Error("This brand is archived. Restore it before adding campaigns.")
    const today = todayIn(brand.timezone)

    const keywords = await resolveKeywords(supabase, v.client_id, v.primary_keyword, v.secondary_keywords, v.target_url || null)

    const created = must(
      await supabase
        .from("campaigns")
        .insert({
          name: v.primary_keyword,
          client_id: v.client_id,
          target_url: v.target_url || null,
          target_location: null,
          priority: v.priority,
          status: v.status,
          start_date: today,
          end_date: null,
          // No targets until an admin sets them on the campaign (0 = no target, the column default).
          daily_target: 0,
          weekly_target: 0,
          monthly_target: 0,
          description: v.description || null,
          internal_notes: v.internal_notes || null,
          created_by: userId,
        })
        .select("id")
        .single(),
    )
    await syncRelations(supabase, created.id, {
      ...keywords,
      intern_ids: [],
      backlink_type_ids: v.backlink_type_ids,
    })
    revalidatePath("/admin/campaigns")
    return created.id as string
  }, "Campaign created")
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
    await syncRelations(supabase, copy.id, {
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

        // A campaign's brand never changes: its keywords, tasks and submissions belong to that brand.
        const existing = r.campaign_code
          ? must(await supabase.from("campaigns").select("id, client_id").eq("code", r.campaign_code).maybeSingle())
          : null
        if (r.campaign_code && !existing) throw new Error(`campaign_code ${r.campaign_code} not found`)
        if (existing && existing.client_id !== clientId)
          throw new Error(`campaign_code ${r.campaign_code} belongs to another brand; a campaign's brand cannot be changed`)

        // Keywords are resolved before anything is written, so a failing keyword leaves the campaign untouched.
        const keywords = await resolveKeywords(supabase, clientId, r.primary_keyword ?? "", splitList(r.secondary_keywords), target || null)

        let campaignId: string
        if (existing) {
          campaignId = existing.id
          const { client_id: _client, ...editable } = row
          void _client
          must(await supabase.from("campaigns").update(editable).eq("id", campaignId))
          result.updated++
        } else {
          campaignId = must(await supabase.from("campaigns").insert({ ...row, created_by: userId }).select("id").single()).id
          result.created++
        }

        // Keywords are added (never removed). A new primary replaces the old one first: one primary per campaign.
        if (keywords.primary_keyword_id)
          must(
            await supabase
              .from("campaign_keywords")
              .update({ is_primary: false })
              .eq("campaign_id", campaignId)
              .eq("is_primary", true)
              .neq("keyword_id", keywords.primary_keyword_id),
          )
        if (keywords.keyword_ids.length)
          must(
            await supabase.from("campaign_keywords").upsert(
              keywords.keyword_ids.map((keyword_id) => ({ campaign_id: campaignId, keyword_id, is_primary: keyword_id === keywords.primary_keyword_id })),
              { onConflict: "campaign_id,keyword_id" },
            ),
          )
      } catch (e) {
        result.errors.push({ row: rowNo, message: (e as { message?: string }).message ?? "Failed" })
      }
    }
    revalidatePath("/admin/campaigns")
    return result
  })
}
