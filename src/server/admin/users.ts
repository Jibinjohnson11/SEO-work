"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { createAdminClient } from "@/lib/supabase/admin"
import { appOrigin } from "@/lib/app-url"
import { BLOCKED_RECIPIENT_MESSAGE, emailAllowlist, isAllowedRecipient } from "@/lib/email-allowlist"
import { INVITE_REFUSALS, isConfirmed, planInvite, type InvitePlan } from "@/lib/invite-plan"
import { findAuthUserByEmail } from "@/server/admin/auth-accounts"
import { blankToNull, internUpdateSchema, inviteUserSchema, type InternUpdateInput, type InviteUserInput } from "@/lib/validation"

const id = z.string().uuid()

/** Supabase Auth's answer when an address already has an account (e.g. created a moment ago by another admin). */
function isEmailTaken(error: { code?: string; status?: number; message?: string }) {
  return error.code === "email_exists" || error.code === "user_already_exists" || (error.status === 422 && /already (been )?registered/i.test(error.message ?? ""))
}

/** Profile insert lost to another invitation for the same account or address (primary key / unique email). */
function isDuplicate(error: { code?: string } | null) {
  return error?.code === "23505"
}

/**
 * Invites an intern or client user. Requires SUPABASE_SERVICE_ROLE_KEY. The role is written to
 * app_metadata (not user-editable) and to the profile; Super Admins are never created here.
 *
 * A Supabase Auth account that already exists for the address but has no LinkOps profile (e.g. it
 * was invited from the Supabase dashboard) is linked rather than duplicated: see planInvite().
 *
 * Concurrency (two Super Admins, or a double submit, inviting the same address at once):
 *   1. The sign-in account is found or created WITHOUT sending anything. Supabase allows one
 *      account per address, so a second creator gets "already registered" and uses that account.
 *   2. Inserting the profile is the claim: its primary key (the account id) and the unique email
 *      index let exactly one invitation win. A losing invitation stops there and changes nothing,
 *      so it can never overwrite, roll back or delete what the winner created.
 *   3. Only the winner sets the role marker, links the workspace or campaigns and sends the one
 *      email. If one of those steps fails, it undoes only its own rows, restores the role marker
 *      before releasing its claim, and deletes the account only if it created it and no profile
 *      references it any more.
 */
export async function inviteUser(input: InviteUserInput) {
  const outcome: { mode: InvitePlan["kind"] } = { mode: "create" }
  const result = await run(async () => {
    const data = inviteUserSchema.parse(input)
    const { supabase, userId } = await authorize(["super_admin"])
    if (data.role === "client" && !data.client_id) throw new Error("Choose the client workspace for this user")
    const admin = createAdminClient()
    const email = data.email.toLowerCase()

    // Fast path only; the profile claim below is what actually prevents duplicates.
    const { data: existing } = await supabase.from("profiles").select("id, role").eq("email", email).maybeSingle()
    if (existing) throw new Error(INVITE_REFUSALS.profileExists)
    if (!isAllowedRecipient(email, emailAllowlist())) throw new Error(BLOCKED_RECIPIENT_MESSAGE)

    // 1. Find or create the sign-in account. Nothing is sent yet.
    let account = await findAuthUserByEmail(admin, email)
    let createdHere = false
    if (!account) {
      const c = await admin.auth.admin.createUser({ email, email_confirm: false, user_metadata: { full_name: data.full_name } })
      if (c.error) {
        if (!isEmailTaken(c.error)) throw new Error(`Invitation failed: ${c.error.message}`)
        account = await findAuthUserByEmail(admin, email) // created concurrently elsewhere
        if (!account) throw new Error("Invitation failed: the address is registered but its account could not be read. Try again.")
      } else {
        account = c.data.user
        createdHere = true
      }
    }
    const plan = planInvite({ hasProfile: false, account })
    if (plan.kind === "refuse") throw new Error(plan.reason)
    outcome.mode = createdHere ? "create" : plan.kind
    const accountId = account.id

    /** Removes the account only if this invitation created it and no profile has claimed it since. */
    const releaseNewAccount = async () => {
      if (!createdHere) return
      const { data: claimed, error } = await admin.from("profiles").select("id").eq("id", accountId)
      if (error || claimed?.length) return // claimed by another invitation (or unknown): keep it
      const removed = await admin.auth.admin.deleteUser(accountId)
      if (removed.error) console.error("[inviteUser] cleanup failed; remove this auth user manually", { accountId, error: removed.error.message })
    }

    // 2. Claim: exactly one concurrent invitation can insert this profile.
    const claim = await admin.from("profiles").insert({
      id: accountId,
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
    })
    if (claim.error) {
      await releaseNewAccount()
      if (isDuplicate(claim.error)) throw new Error(INVITE_REFUSALS.concurrent)
      throw claim.error
    }

    // 3. This invitation owns the profile from here on.
    const previousRole = (account.app_metadata?.role as string | undefined) ?? null
    const done = { role: false, member: false, assignments: [] as string[] }
    try {
      must(await admin.auth.admin.updateUserById(accountId, { app_metadata: { role: data.role } }))
      done.role = true
      // Workspace and campaign links are written as the Super Admin so they are audited normally.
      if (data.role === "client") {
        must(
          await supabase.from("client_members").insert({
            client_id: data.client_id,
            user_id: accountId,
            can_approve: data.can_approve,
            can_download_reports: data.can_download_reports,
          }),
        )
        done.member = true
      }
      if (data.role === "intern" && data.campaign_ids.length) {
        must(
          await supabase
            .from("intern_assignments")
            .insert(data.campaign_ids.map((c) => ({ campaign_id: c, intern_id: accountId, assigned_by: userId }))),
        )
        done.assignments = data.campaign_ids
      }
      // The one email, sent last, once everything it leads to is in place.
      const redirectTo = `${await appOrigin()}/auth/confirm?next=/auth/set-password`
      if (plan.kind === "recover") {
        const r = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        if (r.error) throw new Error(`Password setup email failed: ${r.error.message}`)
      } else {
        const r = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: data.full_name } })
        if (r.error) throw new Error(`Invitation failed: ${r.error.message}`)
        if (r.data.user.id !== accountId) throw new Error("Invitation failed: Supabase answered for a different account")
      }
    } catch (error) {
      // Undo exactly this invitation's rows, then release the claim, then (if new) the account.
      const problems: string[] = []
      const step = async (what: string, res: PromiseLike<{ error: { message: string } | null }>) => {
        const { error: e } = await res
        if (e) problems.push(`${what}: ${e.message}`)
      }
      if (done.member) await step("workspace link", admin.from("client_members").delete().eq("client_id", data.client_id).eq("user_id", accountId))
      if (done.assignments.length) await step("campaign assignments", admin.from("intern_assignments").delete().eq("intern_id", accountId).in("campaign_id", done.assignments))
      // Restored while the claim is still held, so it cannot overwrite a later invitation's marker.
      if (done.role) await step("role marker", admin.auth.admin.updateUserById(accountId, { app_metadata: { role: previousRole } }))
      const before = problems.length
      await step("profile", admin.from("profiles").delete().eq("id", accountId))
      if (problems.length === before) await releaseNewAccount()
      if (problems.length) console.error("[inviteUser] rollback incomplete; check this account", { accountId, problems })
      throw error
    }
    revalidatePath("/admin/interns")
    revalidatePath("/admin/users")
    revalidatePath("/admin/settings")
    return accountId
  }, "Invitation sent")
  if (result.ok && outcome.mode === "reinvite") return { ...result, message: "Invitation sent to the existing sign-in account" }
  if (result.ok && outcome.mode === "recover") return { ...result, message: "Account linked. It was already confirmed, so a password setup email was sent instead of an invitation." }
  return result
}

export async function resendInvite(profileId: string) {
  const outcome = { recovered: false }
  const result = await run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const p = must(await supabase.from("profiles").select("email, status").eq("id", id.parse(profileId)).single())
    if (p.status !== "invited") throw new Error("This user has already accepted their invitation. Use “Send password reset” instead.")
    if (!isAllowedRecipient(p.email, emailAllowlist())) throw new Error(BLOCKED_RECIPIENT_MESSAGE)
    const admin = createAdminClient()
    const redirectTo = `${await appOrigin()}/auth/confirm?next=/auth/set-password`
    const account = await admin.auth.admin.getUserById(profileId)
    if (account.error || !account.data.user) throw new Error("This profile has no sign-in account. Remove it and invite the address again.")
    // Supabase refuses to invite an address that is already confirmed (e.g. a linked account), so
    // such a user gets a password-setup link instead; their first sign-in still activates them.
    if (isConfirmed(account.data.user)) {
      const r = await supabase.auth.resetPasswordForEmail(p.email, { redirectTo })
      if (r.error) throw new Error(r.error.message)
      outcome.recovered = true
      return
    }
    const r = await admin.auth.admin.inviteUserByEmail(p.email, { redirectTo })
    if (r.error) throw new Error(r.error.message)
  }, "Invitation re-sent")
  return result.ok && outcome.recovered ? { ...result, message: "Password setup email sent (this address is already confirmed)" } : result
}

export async function sendPasswordReset(profileId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const p = must(await supabase.from("profiles").select("email").eq("id", id.parse(profileId)).single())
    if (!isAllowedRecipient(p.email, emailAllowlist())) throw new Error(BLOCKED_RECIPIENT_MESSAGE)
    const r = await supabase.auth.resetPasswordForEmail(p.email, { redirectTo: `${await appOrigin()}/auth/confirm?next=/auth/set-password` })
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
    revalidatePath("/admin/users")
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
  }, "Team member updated")
}

