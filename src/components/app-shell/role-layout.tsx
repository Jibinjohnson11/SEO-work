import { cookies } from "next/headers"
import { AppShell } from "@/components/app-shell/app-shell"
import { requireRole } from "@/lib/auth"
import { getAllSettings } from "@/server/queries"
import type { AppRole } from "@/lib/types"

/** Shared server layout: enforces the role, loads shell settings and sidebar badge counts. */
export async function RoleLayout({ role, children }: { role: AppRole; children: React.ReactNode }) {
  const { supabase, profile } = await requireRole([role])
  const [settings, cookieStore] = await Promise.all([getAllSettings(), cookies()])
  const unread = supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null)

  const badges: Record<string, number> = {}
  if (role === "super_admin") {
    const [n, review, approvals] = await Promise.all([
      unread,
      supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).in("status", ["submitted", "internal_review"]),
      supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).eq("status", "awaiting_client_approval"),
    ])
    Object.assign(badges, { notifications: n.count ?? 0, review: review.count ?? 0, approvals: approvals.count ?? 0 })
  } else if (role === "intern") {
    const [n, changes] = await Promise.all([
      unread,
      supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).eq("intern_id", profile.id).in("status", ["internal_changes_requested", "client_changes_requested"]),
    ])
    Object.assign(badges, { notifications: n.count ?? 0, changes: changes.count ?? 0 })
  } else {
    const [n, queue] = await Promise.all([unread, supabase.rpc("client_portal_submissions", { p_queue_only: true })])
    Object.assign(badges, { notifications: n.count ?? 0, approvals: (queue.data as unknown[] | null)?.length ?? 0 })
  }

  return (
    <AppShell
      user={{ name: profile.full_name, email: profile.email, role: profile.role }}
      platformName={settings.general.platform_name}
      logoUrl={settings.general.logo_url || null}
      badges={badges}
      initialCollapsed={cookieStore.get("sidebar_collapsed")?.value === "1"}
      idleTimeoutMinutes={settings.security.idle_timeout_minutes}
    >
      {children}
    </AppShell>
  )
}
