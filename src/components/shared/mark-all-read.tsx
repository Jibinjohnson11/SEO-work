"use client"

import { CheckCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAction } from "@/hooks/use-action"
import { markNotificationsRead } from "@/server/notifications"

export function MarkAllRead() {
  const { pending, execute } = useAction()
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => execute(() => markNotificationsRead(), { success: "All caught up" })}>
      <CheckCheck /> Mark all read
    </Button>
  )
}
