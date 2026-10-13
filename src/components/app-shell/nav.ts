import {
  Activity,
  BadgeCheck,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  ClipboardCheck,
  FileText,
  Globe,
  History,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Radar,
  Send,
  Settings,
  ShieldCheck,
  Tags,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react"
import { can, type Feature, type Permissions } from "@/lib/permissions"
import type { AppRole } from "@/lib/types"

export interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  badgeKey?: "review" | "approvals" | "notifications" | "changes" | "registrations"
  /** Shown only to users with this feature (Super Admins have every feature). */
  feature?: Feature
}
export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV: Record<AppRole, NavGroup[]> = {
  super_admin: [
    {
      label: "Main",
      items: [
        { href: "/admin", label: "Overview", icon: LayoutDashboard },
        { href: "/admin/clients", label: "Clients", icon: Building2 },
        { href: "/admin/campaigns", label: "Campaigns", icon: Megaphone },
        { href: "/admin/keywords", label: "Keywords", icon: Tags },
        { href: "/admin/interns", label: "Interns", icon: Users },
        { href: "/admin/tasks", label: "Task Management", icon: ListChecks },
      ],
    },
    {
      label: "Backlink Operations",
      items: [
        { href: "/admin/submissions", label: "Backlink Submissions", icon: Send },
        { href: "/admin/review", label: "Internal Review", icon: ClipboardCheck, badgeKey: "review" },
        { href: "/admin/approvals", label: "Client Approvals", icon: BadgeCheck, badgeKey: "approvals" },
        { href: "/admin/published", label: "Published Backlinks", icon: Globe },
        { href: "/admin/verification", label: "Backlink Verification", icon: Radar },
      ],
    },
    {
      label: "Analytics",
      items: [
        { href: "/admin/reports/daily", label: "Daily Reports", icon: CalendarDays },
        { href: "/admin/reports/weekly", label: "Weekly Reports", icon: CalendarRange },
        { href: "/admin/reports/monthly", label: "Monthly Reports", icon: CalendarClock },
        { href: "/admin/analytics/campaigns", label: "Campaign Analytics", icon: ChartColumn },
        { href: "/admin/analytics/interns", label: "Intern Performance", icon: TrendingUp },
      ],
    },
    {
      label: "Administration",
      items: [
        { href: "/admin/users", label: "Users & Access", icon: UserCheck, badgeKey: "registrations" },
        { href: "/admin/notifications", label: "Notifications", icon: Bell, badgeKey: "notifications" },
        { href: "/admin/activity", label: "Activity Logs", icon: History },
        { href: "/admin/settings", label: "Settings", icon: Settings },
      ],
    },
  ],
  intern: [
    {
      label: "Workspace",
      items: [
        { href: "/intern", label: "My Dashboard", icon: LayoutDashboard, feature: "intern.dashboard" },
        { href: "/intern/tasks", label: "My Tasks", icon: ListChecks, feature: "intern.tasks" },
        { href: "/intern/campaigns", label: "My Campaigns", icon: Megaphone, feature: "intern.campaigns" },
        { href: "/intern/submissions", label: "My Submissions", icon: Send, badgeKey: "changes", feature: "intern.submissions" },
        { href: "/intern/performance", label: "My Performance", icon: Activity, feature: "intern.performance" },
        { href: "/intern/notifications", label: "Notifications", icon: Bell, badgeKey: "notifications", feature: "intern.notifications" },
      ],
    },
  ],
  client: [
    {
      label: "Client Portal",
      items: [
        { href: "/portal", label: "Overview", icon: LayoutDashboard, feature: "portal.overview" },
        { href: "/portal/approvals", label: "Approvals", icon: ShieldCheck, badgeKey: "approvals", feature: "portal.approvals" },
        { href: "/portal/campaigns", label: "Campaigns", icon: Megaphone, feature: "portal.campaigns" },
        { href: "/portal/published", label: "Published Backlinks", icon: Globe, feature: "portal.published" },
        { href: "/portal/reports", label: "Reports", icon: FileText, feature: "portal.reports" },
        { href: "/portal/notifications", label: "Notifications", icon: Bell, badgeKey: "notifications", feature: "portal.notifications" },
      ],
    },
  ],
}

/** The sidebar for a user: their role's items, limited to the features they may use. */
export function navFor(role: AppRole | null, permissions: Permissions | null): NavGroup[] {
  if (!role) return []
  return NAV[role]
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.feature || can(permissions, i.feature)) }))
    .filter((g) => g.items.length > 0)
}

/** Where a user lands: the first page they are allowed to open, or null when there is none. */
export function firstAllowedHref(role: AppRole | null, permissions: Permissions | null) {
  return navFor(role, permissions)[0]?.items[0]?.href ?? null
}

const SEGMENT_LABELS: Record<string, string> = {
  admin: "Admin",
  access: "Account access",
  intern: "Workspace",
  portal: "Portal",
  reports: "Reports",
  analytics: "Analytics",
  new: "New",
  import: "Import",
  edit: "Edit",
}

export function breadcrumbsFor(pathname: string, role: AppRole | null) {
  const items = role ? NAV[role].flatMap((g) => g.items) : []
  const parts = pathname.split("/").filter(Boolean)
  const crumbs: { href: string; label: string }[] = []
  for (let i = 0; i < parts.length; i++) {
    const href = "/" + parts.slice(0, i + 1).join("/")
    const nav = items.find((n) => n.href === href)
    const seg = parts[i]
    const label = nav?.label ?? SEGMENT_LABELS[seg] ?? (/^[0-9a-f-]{36}$/.test(seg) ? "Details" : seg.replace(/-/g, " "))
    crumbs.push({ href, label })
  }
  return crumbs
}
