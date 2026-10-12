"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { createAdminClient } from "@/lib/supabase/admin"
import { publicEnv } from "@/lib/env"
import { blankToNull, internUpdateSchema, inviteUserSchema, type InternUpdateInput, type InviteUserInput } from "@/lib/validation"

const id = z.string().uuid()

async function redirectBase() {
  if (publicEnv.appUrl) return publicEnv.appUrl.replace(/\/$/, "")
  const h = await headers()
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`
}

/**
 * Invites an intern or client user. Requires SUPABASE_SERVICE_ROLE_KEY. The role is written to
 * app_metadata (not user-editable) and to the profile; Super Admins are never created here.
 */
export async function inviteUser(input: InviteUserInput) {
  return run(async () => {
    const data = inviteUserSchema.parse(input)
    const { supabase, userId } = await authorize(["super_admin"])
    if (data.role === "client" && !data.client_id) throw new Error("Choose the client workspace for this user")
    const admin = createAdminClient()
    const email = data.email.toLowerCase()

    const { data: existing } = await supabase.from("profiles").select("id, role").eq("email", email).maybeSingle()
    if (existing) throw new Error("A user with this email already exists")

    const invited = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${await redirectBase()}/auth/confirm?next=/auth/set-password`,
      data: { full_name: data.full_name },
    })
    if (invited.error) throw new Error(`Invitation failed: ${invited.error.message}`)
    const newId = invited.data.user.id
    must(await admin.auth.admin.updateUserById(newId, { app_metadata: { role: data.role } }))
    must(
      await admin.from("profiles").insert({
        id: newId,
        email,
        full_name: data.full_name,
        role: data.role,
        status: "invited",
        job_title: data.job_title || null,
        joining_date: data.joining_date || null,
        daily_target: data.role === "intern" ? data.daily_target : 0,
        weekly_target: data.role === "intern" ? data.weekly_target : 0,
        monthly_target: data.role === "intern" ? data.monthly_target : 0,
        created_by: userId,
      }),
    )
    // Workspace and campaign links are written as the Super Admin so they are audited normally.
    if (data.role === "client")
      must(
        await supabase.from("client_members").insert({
          client_id: data.client_id,
          user_id: newId,
          can_approve: data.can_approve,
          can_download_reports: data.can_download_reports,
        }),
      )
    if (data.role === "intern" && data.campaign_ids.length)
      must(
        await supabase
          .from("intern_assignments")
          .insert(data.campaign_ids.map((c) => ({ campaign_id: c, intern_id: newId, assigned_by: userId }))),
      )
    revalidatePath("/admin/interns")
    revalidatePath("/admin/settings")
    return newId
  }, "Invitation sent")
}

export async function addExistingClientUser(clientId: string, email: string, perms: { can_approve: boolean; can_download_reports: boolean }) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const { data: p } = await supabase.from("profiles").select("id, role").eq("email", z.email().parse(email.trim().toLowerCase())).maybeSingle()
    if (!p) throw new Error("No user with that email. Invite them instead.")
    if (p.role !== "client") throw new Error("Only client users can join a client workspace")
    must(await supabase.from("client_members").insert({ client_id: id.parse(clientId), user_id: p.id, ...perms }))
    revalidatePath(`/admin/clients/${clientId}`)
  }, "User added to workspace")
}

export async function resendInvite(profileId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const p = must(await supabase.from("profiles").select("email, status").eq("id", id.parse(profileId)).single())
    if (p.status !== "invited") throw new Error("This user has already accepted their invitation. Use “Send password reset” instead.")
    const admin = createAdminClient()
    const r = await admin.auth.admin.inviteUserByEmail(p.email, { redirectTo: `${await redirectBase()}/auth/confirm?next=/auth/set-password` })
    if (r.error) throw new Error(r.error.message)
  }, "Invitation re-sent")
}

export async function sendPasswordReset(profileId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const p = must(await supabase.from("profiles").select("email").eq("id", id.parse(profileId)).single())
    const r = await supabase.auth.resetPasswordForEmail(p.email, { redirectTo: `${await redirectBase()}/auth/confirm?next=/auth/set-password` })
    if (r.error) throw new Error(r.error.message)
  }, "Password reset email sent")
}

/** Disabling blocks all data access immediately (RLS) and bans the auth user so sessions cannot refresh. */
export async function setUserStatus(profileId: string, status: "active" | "disabled") {
  return run(async () => {
    const { supabase, userId } = await authorize(["super_admin"])
    if (profileId === userId) throw new Error("You cannot change your own status")
    must(await supabase.from("profiles").update({ status }).eq("id", id.parse(profileId)))
    try {
      const admin = createAdminClient()
      await admin.auth.admin.updateUserById(profileId, { ban_duration: status === "disabled" ? "876000h" : "none" })
    } catch {
      // Without the service role key the profile status alone still blocks all access via RLS.
    }
    revalidatePath("/admin/interns")
    revalidatePath("/admin/settings")
  }, status === "disabled" ? "User disabled" : "User re-enabled")
}

export async function updateIntern(internId: string, input: InternUpdateInput) {
  return run(async () => {
    const { campaign_ids, ...fields } = internUpdateSchema.parse(input)
    const { supabase, userId } = await authorize(["super_admin"])
    must(await supabase.from("profiles").update(blankToNull(fields)).eq("id", id.parse(internId)).eq("role", "intern"))
    const { data: existing } = await supabase.from("intern_assignments").select("campaign_id, is_active").eq("intern_id", internId)
    const wanted = new Set(campaign_ids)
    const off = (existing ?? []).filter((a) => a.is_active && !wanted.has(a.campaign_id)).map((a) => a.campaign_id)
    if (off.length) must(await supabase.from("intern_assignments").update({ is_active: false }).eq("intern_id", internId).in("campaign_id", off))
    if (campaign_ids.length)
      must(
        await supabase
          .from("intern_assignments")
          .upsert(campaign_ids.map((c) => ({ campaign_id: c, intern_id: internId, is_active: true, assigned_by: userId })), { onConflict: "campaign_id,intern_id" }),
      )
    revalidatePath(`/admin/interns/${internId}`)
  }, "Intern updated")
}

export async function updateUserName(profileId: string, fullName: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.from("profiles").update({ full_name: z.string().trim().min(1).max(120).parse(fullName) }).eq("id", id.parse(profileId)))
  }, "User updated")
}
