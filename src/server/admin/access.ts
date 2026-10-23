"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { createAdminClient } from "@/lib/supabase/admin"
import { sanitizeFeatures, type AssignableRole } from "@/lib/permissions"
import { approveUserSchema, userAccessSchema, type ApproveUserInput, type UserAccessInput } from "@/lib/validation"

const id = z.string().uuid()
const assignableRole = z.enum(["intern", "client"])

function revalidateAccess() {
  revalidatePath("/admin/users")
  revalidatePath("/admin/settings")
  revalidatePath("/admin/interns")
}

/** Keeps app_metadata in step with the profile (best effort; the profile is the source of truth). */
async function syncAuthRole(userId: string, role: AssignableRole) {
  // Access is governed entirely by the profile, so a failure is logged, not shown.
  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(userId, { app_metadata: { role } })
    if (error) console.error("[syncAuthRole] role marker not updated", { userId, error: error.message })
  } catch (error) {
    console.error("[syncAuthRole] role marker not updated", { userId, error: (error as Error).message })
  }
}

/**
 * Approves a self-registered (pending or previously rejected) account: assigns its role, the
 * features it may use, and its workspace or campaigns — atomically, in approve_registration().
 */
export async function approveUser(userId: string, input: ApproveUserInput) {
  return run(async () => {
    const data = approveUserSchema.parse(input)
    const { supabase } = await authorize(["super_admin"])
    const features = data.use_role_defaults ? null : sanitizeFeatures(data.role, data.features)
    must(
      await supabase.rpc("approve_registration", {
        p_user_id: id.parse(userId),
        p_role: data.role,
        p_permissions: features,
        p_client_id: data.role === "client" ? data.client_id : null,
        p_can_approve: data.can_approve,
        p_can_download_reports: data.can_download_reports,
        p_campaign_ids: data.role === "intern" ? data.campaign_ids : [],
      }),
    )
    await syncAuthRole(userId, data.role)
    revalidateAccess()
  }, "Account approved")
}

export async function rejectUser(userId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const updated = must(
      await supabase.from("profiles").update({ status: "rejected" }).eq("id", id.parse(userId)).eq("status", "pending").select("id"),
    )
    if (!updated.length) throw new Error("Only accounts awaiting approval can be rejected")
    revalidateAccess()
  }, "Registration rejected")
}

/** Sets which features an approved intern or client user may use. Takes effect on their next request. */
export async function updateUserAccess(userId: string, input: UserAccessInput) {
  return run(async () => {
    const data = userAccessSchema.parse(input)
    const { supabase } = await authorize(["super_admin"])
    const p = must(await supabase.from("profiles").select("role").eq("id", id.parse(userId)).single())
    const role = assignableRole.safeParse(p.role)
    if (!role.success) throw new Error("Feature access can be set for approved team member and client accounts only")
    const permissions = data.use_role_defaults ? null : sanitizeFeatures(role.data, data.features)
    must(await supabase.from("profiles").update({ permissions }).eq("id", userId))
    revalidateAccess()
  }, "Access updated")
}

/** Default features for users of a role who follow the role defaults. */
export async function updateRoleDefaults(role: AssignableRole, features: string[]) {
  return run(async () => {
    const r = assignableRole.parse(role)
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.from("role_permissions").update({ features: sanitizeFeatures(r, z.array(z.string()).parse(features)) }).eq("role", r))
    revalidateAccess()
  }, "Role defaults saved")
}
