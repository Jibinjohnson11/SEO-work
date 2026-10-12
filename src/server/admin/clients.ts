"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { blankToNull, clientSchema, portalSettingsSchema, type ClientInput } from "@/lib/validation"

const id = z.string().uuid()

export async function saveClient(clientId: string | null, input: ClientInput) {
  return run(async () => {
    const data = blankToNull(clientSchema.parse(input))
    const { supabase, userId } = await authorize(["super_admin"])
    const row = { ...data, archived_at: data.status === "archived" ? new Date().toISOString() : null }
    if (clientId) {
      must(await supabase.from("clients").update(row).eq("id", id.parse(clientId)))
      revalidatePath(`/admin/clients/${clientId}`)
      return clientId
    }
    const created = must(await supabase.from("clients").insert({ ...row, created_by: userId }).select("id").single())
    revalidatePath("/admin/clients")
    return created.id as string
  }, clientId ? "Client updated" : "Client created")
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
  }, status === "archived" ? "Client archived" : "Client updated")
}

export async function deleteClient(clientId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const { count } = await supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("client_id", clientId)
    if (count) throw new Error("This client has campaigns. Archive it instead so history is preserved.")
    must(await supabase.from("clients").delete().eq("id", id.parse(clientId)))
    revalidatePath("/admin/clients")
  }, "Client deleted")
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
