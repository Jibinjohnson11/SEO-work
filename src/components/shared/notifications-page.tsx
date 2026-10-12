import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { MarkAllRead } from "@/components/shared/mark-all-read"
import { formatDateTime, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AppRole, Notification } from "@/lib/types"

export async function NotificationsPage({ role }: { role: AppRole }) {
  const { supabase, profile } = await requireRole([role])
  const { data } = await supabase.from("notifications").select("id, type, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(200)
  const items = (data ?? []) as Notification[]
  const unread = items.filter((n) => !n.read_at).length
  return (
    <>
      <PageHeader title="Notifications" description={`${unread} unread · latest 200`} actions={unread ? <MarkAllRead /> : null} />
      <div className="overflow-hidden rounded-xl border bg-card">
        {items.length === 0 ? (
          <EmptyState title="No notifications" description="You'll be notified about assignments, reviews, approvals, publications and verification problems." />
        ) : (
          <ul>
            {items.map((n) => {
              const body = (
                <div className={cn("flex gap-3 border-b px-4 py-3 last:border-0", !n.read_at && "bg-accent/40")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{n.title}</div>
                    {n.body ? <div className="text-sm text-muted-foreground">{n.body}</div> : null}
                    <div className="text-xs text-muted-foreground" title={formatDateTime(n.created_at, profile.timezone)}>{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              )
              return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-muted/40">{body}</Link> : body}</li>
            })}
          </ul>
        )}
      </div>
    </>
  )
}
