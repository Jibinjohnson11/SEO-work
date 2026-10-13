"use server"

import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import type { Notification } from "@/lib/types"

const ALL_ROLES = ["super_admin", "intern", "client"] as const
const NOTIFICATIONS = { intern: "intern.notifications", client: "portal.notifications" } as const

export async function getRecentNotifications() {
  return run(async () => {
    const { supabase } = await authorize([...ALL_ROLES], NOTIFICATIONS)
    const [list, unread] = await Promise.all([
      supabase.from("notifications").select("id, type, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(12),
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ])
    return { items: (list.data ?? []) as Notification[], unread: unread.count ?? 0 }
  })
}

export async function markNotificationsRead(ids?: string[]) {
  return run(async () => {
    const { supabase, userId } = await authorize([...ALL_ROLES], NOTIFICATIONS)
    let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null)
    if (ids?.length) q = q.in("id", z.array(z.string().uuid()).parse(ids))
    must(await q)
  })
}
