"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { LOGO_BUCKET, logoExtension, logoFileProblem } from "@/lib/brand-logo"
import { blankToNull, clientSchema, portalSettingsSchema, type ClientInput } from "@/lib/validation"

const id = z.string().uuid()

export async function saveClient(clientId: string | null, input: ClientInput) {
  return run(async () => {
    const data = blankToNull(clientSchema.parse(input))
    const { supabase, userId } = await authorize(["super_admin"])
    // Client approval is the approval stage; the database adds internal review for medical brands
    // (campaign_flags), so the stored flag is kept off.
    const row = { ...data, require_internal_review: false, archived_at: data.status === "archived" ? new Date().toISOString() : null }
    if (clientId) {
      must(await supabase.from("clients").update(row).eq("id", id.parse(clientId)))
      revalidatePath("/admin/clients")
      revalidatePath(`/admin/clients/${clientId}`)
      return clientId
    }
    const created = must(await supabase.from("clients").insert({ ...row, created_by: userId }).select("id").single())
    revalidatePath("/admin/clients")
    return created.id as string
  }, clientId ? "Brand updated" : "Brand created")
}

// SVG is drawn only through <img> (scripts never run there), but a signed URL can be opened directly,
// so anything able to run code is refused at upload.
const UNSAFE_SVG = /<script|<foreignObject|\bon[a-z]+\s*=|javascript:|<!ENTITY|<iframe|<embed|<object/i

export async function setClientLogo(formData: FormData) {
  return run(async () => {
    const clientId = id.parse(formData.get("client_id"))
    const file = formData.get("logo")
    if (!(file instanceof File)) throw new Error("Choose a logo file")
    const problem = logoFileProblem(file)
    if (problem) throw new Error(problem)
    if (file.type === "image/svg+xml") {
      const text = await file.text()
      if (!/<svg[\s>]/i.test(text) || UNSAFE_SVG.test(text)) throw new Error("This SVG contains scripts or unsupported content. Export a plain SVG or use PNG.")
    }
    const { supabase } = await authorize(["super_admin"])
    const current = must(await supabase.from("clients").select("logo_path").eq("id", clientId).single())
    const path = `${clientId}/${randomUUID()}.${logoExtension(file.name)}`
    const up = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) throw new Error(`Logo upload failed: ${up.error.message}`)
    const saved = await supabase.from("clients").update({ logo_path: path }).eq("id", clientId)
    if (saved.error) {
      await supabase.storage.from(LOGO_BUCKET).remove([path])
      throw saved.error
    }
    if (current.logo_path) await supabase.storage.from(LOGO_BUCKET).remove([current.logo_path])
    revalidatePath("/admin/clients")
    revalidatePath(`/admin/clients/${clientId}`)
  }, "Logo saved")
}

export async function removeClientLogo(clientId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const cid = id.parse(clientId)
    const current = must(await supabase.from("clients").select("logo_path").eq("id", cid).single())
    if (!current.logo_path) return
    must(await supabase.from("clients").update({ logo_path: null }).eq("id", cid))
    await supabase.storage.from(LOGO_BUCKET).remove([current.logo_path])
    revalidatePath("/admin/clients")
    revalidatePath(`/admin/clients/${cid}`)
  }, "Logo removed")
}

export async function setClientStatus(clientId: string, status: "active" | "paused" | "archived") {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(
      await supabase
        .from("clients")
        .update({ status, archived_at: status === "archived" ? new Date().toISOString() : null })
        .eq("id", id.parse(clientId)),
    )
    revalidatePath("/admin/clients")
  }, status === "archived" ? "Brand archived" : "Brand updated")
}

export async function deleteClient(clientId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const cid = id.parse(clientId)
    const { count } = await supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("client_id", cid)
    if (count) throw new Error("This brand has campaigns. Archive it instead so history is preserved.")
    must(await supabase.from("clients").delete().eq("id", cid))
    revalidatePath("/admin/clients")
  }, "Brand deleted")
}

export async function savePortalSettings(clientId: string, settings: z.infer<typeof portalSettingsSchema>) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.from("clients").update({ portal_settings: portalSettingsSchema.parse(settings) }).eq("id", id.parse(clientId)))
    revalidatePath(`/admin/clients/${clientId}`)
  }, "Portal visibility saved")
}

export async function setMemberPermissions(memberId: string, perms: { can_approve: boolean; can_download_reports: boolean }) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.from("client_members").update(perms).eq("id", id.parse(memberId)))
  }, "Permissions updated")
}

export async function removeMember(memberId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.from("client_members").delete().eq("id", id.parse(memberId)))
  }, "Member removed from workspace")
}
