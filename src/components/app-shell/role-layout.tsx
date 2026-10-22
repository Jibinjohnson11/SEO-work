import { cookies } from "next/headers"
import { AppShell } from "@/components/app-shell/app-shell"
import { requireRole } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { getAllSettings } from "@/server/queries"
import type { AppRole } from "@/lib/types"

/** Shared server layout: enforces the role, loads shell settings and sidebar badge counts. */
export async function RoleLayout({ role, children }: { role: AppRole; children: React.ReactNode }) {
  const { supabase, profile, permissions } = await requireRole([role])
  const [settings, cookieStore] = await Promise.all([getAllSettings(), cookies()])
  const unread = supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null)

  const none = Promise.resolve({ count: 0, data: [] as unknown[], error: null })
  // Badge counts are hints: a failed count shows 0 so the navigation still works, but it is logged.
  const logFailures = (results: { error: { message?: string } | null }[]) => {
    for (const r of results) if (r.error) console.error("[badges] count failed", r.error.message)
  }

  const badges: Record<string, number> = {}
  if (role === "super_admin") {
    const [n, content, approvals, contentApprovals, registrations, review] = await Promise.all([
      unread,
      supabase.from("offpage_contents").select("id", { count: "exact", head: true }).eq("status", "changes_requested"),
      supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).eq("status", "awaiting_client_approval"),
      supabase.from("offpage_contents").select("id", { count: "exact", head: true }).eq("status", "awaiting_client_approval"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).in("status", ["submitted", "internal_review"]),
    ])
    logFailures([n, content, approvals, contentApprovals, registrations, review])
    Object.assign(badges, {
      notifications: n.count ?? 0,
      content: content.count ?? 0,
      approvals: (approvals.count ?? 0) + (contentApprovals.count ?? 0),
      registrations: registrations.count ?? 0,
      review: review.count ?? 0,
    })
  } else if (role === "intern") {
    const [n, changes, content] = await Promise.all([
      can(permissions, "intern.notifications") ? unread : none,
      can(permissions, "intern.submissions")
        ? supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).eq("intern_id", profile.id).in("status", ["internal_changes_requested", "client_changes_requested"])
        : none,
      can(permissions, "intern.content")
        ? supabase.from("offpage_contents").select("id", { count: "exact", head: true }).eq("submitted_by", profile.id).eq("status", "changes_requested")
        : none,
    ])
    logFailures([n, changes, content])
    Object.assign(badges, { notifications: n.count ?? 0, changes: changes.count ?? 0, content: content.count ?? 0 })
  } else {
    const [n, queue, contentQueue] = await Promise.all([
      can(permissions, "portal.notifications") ? unread : none,
      can(permissions, "portal.approvals") ? supabase.rpc("client_portal_submissions", { p_queue_only: true }) : none,
      can(permissions, "portal.approvals") ? supabase.rpc("client_portal_offpage_contents", { p_queue_only: true }) : none,
    ])
    logFailures([n, queue, contentQueue])
    Object.assign(badges, {
      notifications: n.count ?? 0,
      approvals: ((queue.data as unknown[] | null)?.length ?? 0) + ((contentQueue.data as unknown[] | null)?.length ?? 0),
    })
  }

  return (
    <AppShell
      user={{ name: profile.full_name, email: profile.email, role: profile.role, permissions }}
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
