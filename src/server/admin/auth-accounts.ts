import "server-only"
import type { User } from "@supabase/supabase-js"
import type { createAdminClient } from "@/lib/supabase/admin"

type AdminClient = ReturnType<typeof createAdminClient>

const PAGE_SIZE = 1000
const MAX_PAGES = 50 // 50,000 accounts: far beyond an agency's user base; stops a runaway loop

/** Every Supabase Auth account, through the Admin API (the service role has no SQL access to auth.users here). */
async function* allAuthUsers(admin: AdminClient) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (error) throw new Error(`Could not read sign-in accounts: ${error.message}`)
    yield* data.users
    if (data.users.length < PAGE_SIZE) return
  }
  throw new Error("Too many sign-in accounts to search")
}

/** The Auth account for an email (case-insensitive), or null. */
export async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<User | null> {
  const wanted = email.trim().toLowerCase()
  for await (const u of allAuthUsers(admin)) if (u.email?.toLowerCase() === wanted) return u
  return null
}

export type AccountWithoutProfile = { id: string; email: string; created_at: string; invited_at: string | null; confirmed: boolean; last_sign_in_at: string | null }

/** Auth accounts that have no LinkOps profile (so no role and no access), newest first. */
export async function accountsWithoutProfile(admin: AdminClient, profileIds: Set<string>): Promise<AccountWithoutProfile[]> {
  const out: AccountWithoutProfile[] = []
  for await (const u of allAuthUsers(admin)) {
    if (profileIds.has(u.id) || !u.email) continue
    out.push({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      invited_at: u.invited_at ?? null,
      confirmed: Boolean(u.email_confirmed_at || u.confirmed_at || u.last_sign_in_at),
      last_sign_in_at: u.last_sign_in_at ?? null,
    })
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
}
