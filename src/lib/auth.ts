import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { isSupabaseConfigured } from "@/lib/env"
import { firstAllowedHref } from "@/components/app-shell/nav"
import { can, type Feature } from "@/lib/permissions"
import type { AppRole, Profile } from "@/lib/types"

export const HOME_FOR_ROLE: Record<AppRole, string> = {
  super_admin: "/admin",
  intern: "/intern",
  client: "/portal",
}

/** Signed-in users who are pending approval, rejected, or approved without any feature land here. */
export const ACCESS_PAGE = "/access"

/** A feature, or one feature per role for actions shared between roles. Super Admins pass any check. */
export type FeatureRequirement = Feature | Partial<Record<AppRole, Feature>>

type ActiveProfile = Profile & { role: AppRole }

/**
 * Verified session (JWT signature checked by getClaims), the user's profile and their effective
 * permissions from public.my_permissions() — the same function the database policies use.
 */
export const getSession = cache(async () => {
  if (!isSupabaseConfigured()) return null
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (!userId) return null
  const [{ data: profile }, { data: permissions }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.rpc("my_permissions"),
  ])
  return { supabase, userId, profile: (profile as Profile | null) ?? null, permissions: ((permissions as string[] | null) ?? []) as readonly string[] }
})

function isActive(profile: Profile | null): profile is ActiveProfile {
  return !!profile && profile.status === "active" && profile.role !== null
}

function featureFor(requirement: FeatureRequirement | undefined, role: AppRole): Feature | undefined {
  if (!requirement || role === "super_admin") return undefined
  return typeof requirement === "string" ? requirement : requirement[role]
}

function allowed(requirement: FeatureRequirement | undefined, role: AppRole, permissions: readonly string[]) {
  if (!requirement || role === "super_admin") return true
  const feature = featureFor(requirement, role)
  return !!feature && can(permissions, feature)
}

/** Where a signed-in user should go: their first permitted page, or the access page. */
export function landingFor(profile: Profile | null, permissions: readonly string[]) {
  if (!isActive(profile)) return profile?.status === "pending" || profile?.status === "rejected" ? ACCESS_PAGE : "/auth/no-access"
  if (profile.role === "super_admin") return HOME_FOR_ROLE.super_admin
  return firstAllowedHref(profile.role, permissions) ?? ACCESS_PAGE
}

/** Landing page for the user signed in on this client (used right after sign-in). */
export async function landingForClient(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (!userId) return "/login"
  const [{ data: profile }, { data: permissions }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.rpc("my_permissions"),
  ])
  return landingFor((profile as Profile | null) ?? null, (permissions as string[] | null) ?? [])
}

/**
 * For pages and layouts: redirects when signed out, not approved, in the wrong area, or
 * missing the feature this page belongs to.
 */
export async function requireRole(roles: AppRole[], feature?: FeatureRequirement) {
  if (!isSupabaseConfigured()) redirect("/setup")
  const session = await getSession()
  if (!session) redirect("/login")
  const { profile, permissions } = session
  if (!isActive(profile)) redirect(landingFor(profile, permissions))
  if (!roles.includes(profile.role)) redirect(landingFor(profile, permissions))
  if (!allowed(feature, profile.role, permissions)) redirect(landingFor(profile, permissions))
  return { ...session, profile }
}

export class ActionError extends Error {}

/** For server actions and route handlers: throws instead of redirecting. */
export async function authorize(roles: AppRole[], feature?: FeatureRequirement) {
  const session = await getSession()
  const profile = session?.profile ?? null
  if (!session || !isActive(profile)) throw new ActionError("You are not signed in.")
  if (!roles.includes(profile.role)) throw new ActionError("You do not have permission to do that.")
  if (!allowed(feature, profile.role, session.permissions))
    throw new ActionError("Your account does not have access to this feature.")
  return { ...session, profile }
}
