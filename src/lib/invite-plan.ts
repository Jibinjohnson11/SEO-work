/**
 * How a Super Admin's invitation is carried out for an email address, given what already exists.
 *
 * A Supabase Auth account can exist without a LinkOps profile, e.g. when someone was invited or
 * created directly in the Supabase dashboard. Such an account has no role and no access. Inviting
 * the same address from LinkOps links that account (same id, so never a duplicate) and assigns the
 * role chosen in the invitation form:
 *   - not yet confirmed  → Supabase re-sends an invitation to the existing account;
 *   - already confirmed  → Supabase refuses a second invitation, so a password-setup (recovery)
 *                          email is sent instead. Either way the profile starts as 'invited' and
 *                          becomes 'active' on the person's first sign-in, exactly like a new invite.
 */

/** The fields of a Supabase Auth user this decision needs (a subset of @supabase/supabase-js User). */
export type ExistingAuthAccount = {
  id: string
  email_confirmed_at?: string | null
  confirmed_at?: string | null
  last_sign_in_at?: string | null
  banned_until?: string | null
  app_metadata?: Record<string, unknown> | null
}

export type InvitePlan =
  | { kind: "create" }
  | { kind: "reinvite"; userId: string }
  | { kind: "recover"; userId: string }
  | { kind: "refuse"; reason: string }

export const INVITE_REFUSALS = {
  profileExists: "A user with this email already exists",
  superAdmin: "This address belongs to a Super Admin sign-in account. It cannot be invited as an intern or client.",
  banned: "This sign-in account is banned in Supabase Auth. Lift the ban there before inviting it.",
  concurrent: "This address was just invited by someone else. Refresh the page to see it.",
} as const

export function isConfirmed(account: ExistingAuthAccount) {
  return Boolean(account.email_confirmed_at || account.confirmed_at || account.last_sign_in_at)
}

export function planInvite(input: { hasProfile: boolean; account: ExistingAuthAccount | null; now?: number }): InvitePlan {
  const { hasProfile, account, now = Date.now() } = input
  if (hasProfile) return { kind: "refuse", reason: INVITE_REFUSALS.profileExists }
  if (!account) return { kind: "create" }
  if (account.app_metadata?.role === "super_admin") return { kind: "refuse", reason: INVITE_REFUSALS.superAdmin }
  if (account.banned_until && Date.parse(account.banned_until) > now) return { kind: "refuse", reason: INVITE_REFUSALS.banned }
  return isConfirmed(account) ? { kind: "recover", userId: account.id } : { kind: "reinvite", userId: account.id }
}
