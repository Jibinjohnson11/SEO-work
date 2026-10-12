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
  Users,
} from "lucide-react"
import type { AppRole } from "@/lib/types"

export interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  badgeKey?: "review" | "approvals" | "notifications" | "changes"
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
        { href: "/intern", label: "My Dashboard", icon: LayoutDashboard },
        { href: "/intern/tasks", label: "My Tasks", icon: ListChecks },
        { href: "/intern/campaigns", label: "My Campaigns", icon: Megaphone },
        { href: "/intern/submissions", label: "My Submissions", icon: Send, badgeKey: "changes" },
        { href: "/intern/performance", label: "My Performance", icon: Activity },
        { href: "/intern/notifications", label: "Notifications", icon: Bell, badgeKey: "notifications" },
      ],
    },
  ],
  client: [
    {
      label: "Client Portal",
      items: [
        { href: "/portal", label: "Overview", icon: LayoutDashboard },
        { href: "/portal/approvals", label: "Approvals", icon: ShieldCheck, badgeKey: "approvals" },
        { href: "/portal/campaigns", label: "Campaigns", icon: Megaphone },
        { href: "/portal/published", label: "Published Backlinks", icon: Globe },
        { href: "/portal/reports", label: "Reports", icon: FileText },
        { href: "/portal/notifications", label: "Notifications", icon: Bell, badgeKey: "notifications" },
      ],
    },
  ],
}

const SEGMENT_LABELS: Record<string, string> = {
  admin: "Admin",
  intern: "Workspace",
  portal: "Portal",
  reports: "Reports",
  analytics: "Analytics",
  new: "New",
  import: "Import",
  edit: "Edit",
}

export function breadcrumbsFor(pathname: string, role: AppRole) {
  const items = NAV[role].flatMap((g) => g.items)
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
