import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Team members who can receive tasks: intern accounts (the database only accepts those) that are
 * active or invited and whose effective permissions include "My Tasks", so they can see the work.
 */
export async function assignableMembers(supabase: SupabaseClient) {
  const [profiles, defaults] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, permissions").eq("role", "intern").in("status", ["active", "invited"]).order("full_name"),
    supabase.from("role_permissions").select("features").eq("role", "intern").maybeSingle(),
  ])
  const roleFeatures: string[] = defaults.data?.features ?? []
  return ((profiles.data ?? []) as { id: string; full_name: string; email: string; permissions: string[] | null }[])
    .filter((p) => {
      const features = p.permissions ?? roleFeatures
      return features.includes("*") || features.includes("intern.tasks")
    })
    .map((p) => ({ id: p.id, label: p.full_name || p.email }))
}
