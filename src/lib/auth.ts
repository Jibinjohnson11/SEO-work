import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { isSupabaseConfigured } from "@/lib/env"
import type { AppRole, Profile } from "@/lib/types"

export const HOME_FOR_ROLE: Record<AppRole, string> = {
  super_admin: "/admin",
  intern: "/intern",
  client: "/portal",
}

/** Verified session (JWT signature checked by getClaims) plus the user's profile. */
export const getSession = cache(async () => {
  if (!isSupabaseConfigured()) return null
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (!userId) return null
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle()
  return { supabase, userId, profile: (profile as Profile | null) ?? null }
})

/** For pages and layouts: redirects when signed out, inactive, or in the wrong area. */
export async function requireRole(roles: AppRole[]) {
  if (!isSupabaseConfigured()) redirect("/setup")
  const session = await getSession()
  if (!session) redirect("/login")
  const { profile } = session
  if (!profile || profile.status !== "active") redirect("/auth/no-access")
  if (!roles.includes(profile.role)) redirect(HOME_FOR_ROLE[profile.role])
  return { ...session, profile }
}

export class ActionError extends Error {}

/** For server actions and route handlers: throws instead of redirecting. */
export async function authorize(roles: AppRole[]) {
  const session = await getSession()
  if (!session?.profile || session.profile.status !== "active") throw new ActionError("You are not signed in.")
  if (!roles.includes(session.profile.role)) throw new ActionError("You do not have permission to do that.")
  return { ...session, profile: session.profile }
}
