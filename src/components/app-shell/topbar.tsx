"use client"

import { Fragment, useEffect, useState, useSyncExternalStore, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { Bell, ChevronRight, LogOut, Monitor, Moon, Search, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { getRecentNotifications, markNotificationsRead } from "@/server/notifications"
import { globalSearch, type SearchHit } from "@/server/search"
import { signOut } from "@/server/auth-actions"
import { initials, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Notification } from "@/lib/types"
import type { ShellUser } from "@/components/app-shell/app-shell"

export function Topbar({
  user,
  crumbs,
  unread,
  menuButton,
}: {
  user: ShellUser
  crumbs: { href: string; label: string }[]
  unread: number
  menuButton: React.ReactNode
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-backdrop-filter:bg-background/70 sm:px-6">
      {menuButton}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 items-center gap-1 text-sm sm:flex">
        {crumbs.map((c, i) => (
          <Fragment key={c.href}>
            {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /> : null}
            {i === crumbs.length - 1 ? (
              <span className="truncate font-medium" aria-current="page">
                {c.label}
              </span>
            ) : (
              <Link href={c.href} className="truncate text-muted-foreground hover:text-foreground">
                {c.label}
              </Link>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="flex flex-1 items-center justify-end gap-1 sm:flex-none">
        <GlobalSearch />
        <NotificationBell unread={unread} role={user.role} />
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  )
}

function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, startTransition] = useTransition()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (q.trim().length < 2) return
    const t = setTimeout(() => {
      startTransition(async () => {
        const r = await globalSearch(q)
        setHits(r.ok ? (r.data ?? []) : [])
      })
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const visibleHits = q.trim().length >= 2 ? hits : []
  const groups = visibleHits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    ;(acc[h.group] ??= []).push(h)
    return acc
  }, {})

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-9 justify-center text-muted-foreground sm:w-56 sm:justify-start"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <Search />
        <span className="hidden flex-1 text-left sm:inline">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1 text-[10px] sm:inline">⌘K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search across the platform">
        <CommandInput placeholder="Search clients, campaigns, submissions, keywords…" value={q} onValueChange={setQ} />
        <CommandList>
          {q.trim().length >= 2 && !loading ? <CommandEmpty>No results.</CommandEmpty> : null}
          {loading && visibleHits.length === 0 ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-6" />
              <Skeleton className="h-6" />
            </div>
          ) : null}
          {Object.entries(groups).map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((h) => (
                <CommandItem
                  key={h.href + h.label}
                  value={`${h.group} ${h.label} ${h.hint ?? ""}`}
                  onSelect={() => {
                    setOpen(false)
                    router.push(h.href)
                  }}
                >
                  <span className="truncate">{h.label}</span>
                  {h.hint ? <span className="ml-auto truncate text-xs text-muted-foreground">{h.hint}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  )
}

function NotificationBell({ unread, role }: { unread: number; role: ShellUser["role"] }) {
  const router = useRouter()
  const [items, setItems] = useState<Notification[] | null>(null)
  const [count, setCount] = useState(unread)
  const [lastUnread, setLastUnread] = useState(unread)
  if (lastUnread !== unread) {
    setLastUnread(unread)
    setCount(unread)
  }
  const allHref = role === "super_admin" ? "/admin/notifications" : role === "intern" ? "/intern/notifications" : "/portal/notifications"

  const load = async () => {
    const r = await getRecentNotifications()
    if (r.ok && r.data) {
      setItems(r.data.items)
      setCount(r.data.unread)
    }
  }

  return (
    <Popover onOpenChange={(o) => o && void load()}>
      <PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="relative" aria-label={`Notifications${count ? `, ${count} unread` : ""}`} />}>
        <Bell />
        {count > 0 ? (
          <span className="tabular absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <button
            type="button"
            className="text-xs text-primary hover:underline disabled:opacity-50"
            disabled={!count}
            onClick={async () => {
              await markNotificationsRead()
              setCount(0)
              setItems((xs) => xs?.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) ?? null)
              router.refresh()
            }}
          >
            Mark all read
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items === null ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                className={cn("flex w-full gap-2 border-b px-3 py-2.5 text-left last:border-0 hover:bg-muted", !n.read_at && "bg-accent/40")}
                onClick={async () => {
                  if (!n.read_at) await markNotificationsRead([n.id])
                  if (n.link) router.push(n.link)
                  else router.refresh()
                }}
              >
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  {n.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span> : null}
                  <span className="text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))
          )}
        </div>
        <Link href={allHref} className="block border-t px-3 py-2 text-center text-xs text-primary hover:underline">
          View all notifications
        </Link>
      </PopoverContent>
    </Popover>
  )
}

const subscribeNoop = () => () => {}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false)
  const Icon = !mounted ? Monitor : theme === "dark" ? Moon : theme === "light" ? Sun : Monitor
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Theme" />}>
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu({ user }: { user: ShellUser }) {
  const profileHref = user.role === "super_admin" ? "/admin/profile" : user.role === "intern" ? "/intern/profile" : "/portal/profile"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className="ml-1 flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu" />}
      >
        {initials(user.name || user.email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="truncate text-sm font-medium text-foreground">{user.name || user.email}</div>
            <div className="truncate text-xs font-normal">{user.email}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={profileHref} />}>Profile & security</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
