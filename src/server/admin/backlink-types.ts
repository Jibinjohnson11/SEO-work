"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { backlinkTypeSchema, type BacklinkTypeInput } from "@/lib/validation"
import { CONFIGURABLE_REQUIRED_FIELDS } from "@/lib/workflow"

const id = z.string().uuid()
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "type"

export async function saveBacklinkType(typeId: string | null, input: BacklinkTypeInput) {
  return run(async () => {
    const { campaign_ids, ...data } = backlinkTypeSchema.parse(input)
    const required = data.required_fields.filter((f) => (CONFIGURABLE_REQUIRED_FIELDS as readonly string[]).includes(f))
    const { supabase } = await authorize(["super_admin"])
    const row = { ...data, required_fields: required }
    let tid = typeId
    if (tid) must(await supabase.from("backlink_types").update(row).eq("id", id.parse(tid)))
    else tid = must(await supabase.from("backlink_types").insert({ ...row, slug: `${slugify(data.name)}-${Date.now().toString(36)}` }).select("id").single()).id as string

    // "Allowed campaigns": explicit links. Campaigns with no rows allow every active type.
    const { data: links } = await supabase.from("campaign_backlink_types").select("campaign_id").eq("backlink_type_id", tid)
    const have = new Set((links ?? []).map((l) => l.campaign_id))
    const want = new Set(campaign_ids)
    const remove = [...have].filter((c) => !want.has(c))
    if (remove.length) must(await supabase.from("campaign_backlink_types").delete().eq("backlink_type_id", tid).in("campaign_id", remove))
    const add = campaign_ids.filter((c) => !have.has(c))
    if (add.length) must(await supabase.from("campaign_backlink_types").insert(add.map((c) => ({ campaign_id: c, backlink_type_id: tid }))))
    revalidatePath("/admin/settings")
  }, typeId ? "Backlink type updated" : "Backlink type created")
}

export async function setBacklinkTypeActive(typeId: string, isActive: boolean) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.from("backlink_types").update({ is_active: isActive }).eq("id", id.parse(typeId)))
    revalidatePath("/admin/settings")
  }, isActive ? "Type activated" : "Type deactivated")
}

export async function moveBacklinkType(typeId: string, direction: "up" | "down") {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const { data } = await supabase.from("backlink_types").select("id, sort_order").order("sort_order").order("name")
    const list = data ?? []
    const i = list.findIndex((t) => t.id === typeId)
    const j = direction === "up" ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    for (const [k, t] of list.entries()) if (t.sort_order !== (k + 1) * 10) must(await supabase.from("backlink_types").update({ sort_order: (k + 1) * 10 }).eq("id", t.id))
    revalidatePath("/admin/settings")
  })
}
