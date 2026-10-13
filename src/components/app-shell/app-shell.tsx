"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "motion/react"
import { ChevronsLeft, ChevronsRight, Link2, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { breadcrumbsFor, navFor, type NavGroup } from "@/components/app-shell/nav"
import { Topbar } from "@/components/app-shell/topbar"
import { IdleSignOut } from "@/components/app-shell/idle-sign-out"
import { cn } from "@/lib/utils"
import type { Permissions } from "@/lib/permissions"
import type { AppRole } from "@/lib/types"

export interface ShellUser {
  name: string
  email: string
  /** Null while the account is awaiting approval. */
  role: AppRole | null
  /** Effective features (["*"] for a Super Admin). The server enforces these; the shell only hides links. */
  permissions: Permissions
}

export function AppShell({
  user,
  platformName,
  logoUrl,
  badges,
  initialCollapsed,
  idleTimeoutMinutes,
  children,
}: {
  user: ShellUser
  platformName: string
  logoUrl?: string | null
  badges: Partial<Record<"review" | "approvals" | "notifications" | "changes" | "registrations", number>>
  initialCollapsed: boolean
  idleTimeoutMinutes: number
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const groups = navFor(user.role, user.permissions)

  // Close the mobile drawer after navigation (state adjusted during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setMobileOpen(false)
  }

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `sidebar_collapsed=${next ? 1 : 0}; path=/; max-age=31536000; samesite=lax`
  }

  return (
    <div className="flex min-h-dvh bg-background">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-[60px]" : "w-64",
        )}
      >
        <Brand name={platformName} logoUrl={logoUrl} collapsed={collapsed} role={user.role} />
        <SidebarNav groups={groups} pathname={pathname} badges={badges} collapsed={collapsed} />
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
            {collapsed ? null : <span>Collapse</span>}
          </Button>
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand name={platformName} logoUrl={logoUrl} collapsed={false} role={user.role} />
          <SidebarNav groups={groups} pathname={pathname} badges={badges} collapsed={false} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          crumbs={breadcrumbsFor(pathname, user.role)}
          unread={badges.notifications ?? 0}
          menuButton={
            <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu />
            </Button>
          }
        />
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-6 sm:px-6"
        >
          {children}
        </motion.main>
      </div>
      {idleTimeoutMinutes > 0 ? <IdleSignOut minutes={idleTimeoutMinutes} /> : null}
    </div>
  )
}

function Brand({ name, logoUrl, collapsed, role }: { name: string; logoUrl?: string | null; collapsed: boolean; role: AppRole | null }) {
  return (
    <div className={cn("flex h-14 items-center gap-2 border-b px-3", collapsed && "justify-center px-0")}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-7 rounded-md object-contain" />
      ) : (
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Link2 className="size-4" />
        </div>
      )}
      {collapsed ? null : (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="text-[11px] text-muted-foreground">
            {role === "super_admin" ? "Super Admin" : role === "intern" ? "Intern workspace" : role === "client" ? "Client portal" : "Awaiting approval"}
          </div>
        </div>
      )}
    </div>
  )
}

function SidebarNav({
  groups,
  pathname,
  badges,
  collapsed,
}: {
  groups: NavGroup[]
  pathname: string
  badges: Partial<Record<string, number>>
  collapsed: boolean
}) {
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href))
  const isActive = (href: string) => {
    if (pathname === href) return true
    if (!pathname.startsWith(href + "/")) return false
    // Pick the most specific match only.
    return !allHrefs.some((h) => h !== href && h.startsWith(href) && (pathname === h || pathname.startsWith(h + "/")))
  }
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Main">
      {groups.map((group) => (
        <div key={group.label} className="space-y-0.5">
          {collapsed ? (
            <div className="mx-auto my-2 h-px w-6 bg-border" />
          ) : (
            <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group.label}</div>
          )}
          {group.items.map((item) => {
            const active = isActive(item.href)
            const count = item.badgeKey ? (badges[item.badgeKey] ?? 0) : 0
            const link = (
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  active && "bg-accent font-medium text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
                {count > 0 ? (
                  collapsed ? (
                    <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" />
                  ) : (
                    <span className="tabular rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground">
                      {count > 99 ? "99+" : count}
                    </span>
                  )
                ) : null}
              </Link>
            )
            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger render={<div />}>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              <div key={item.href}>{link}</div>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
