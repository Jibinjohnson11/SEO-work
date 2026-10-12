"use client"

import { useRouter } from "next/navigation"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAction } from "@/hooks/use-action"
import { duplicateCampaign, setCampaignStatus } from "@/server/admin/campaigns"
import type { CampaignStatus } from "@/lib/types"

export function CampaignRowActions({ id, status }: { id: string; status: CampaignStatus }) {
  const router = useRouter()
  const { pending, execute } = useAction()
  const set = (s: CampaignStatus) => execute(() => setCampaignStatus([id], s))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Campaign actions" disabled={pending} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/admin/campaigns/${id}`)}>Open dashboard</DropdownMenuItem>
        <DropdownMenuItem onClick={() => execute(() => duplicateCampaign(id), { onSuccess: (newId) => newId && router.push(`/admin/campaigns/${newId}`) })}>
          Duplicate configuration
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {status !== "active" ? <DropdownMenuItem onClick={() => set("active")}>Activate</DropdownMenuItem> : null}
        {status === "active" ? <DropdownMenuItem onClick={() => set("paused")}>Pause</DropdownMenuItem> : null}
        {status !== "completed" ? <DropdownMenuItem onClick={() => set("completed")}>Mark completed</DropdownMenuItem> : null}
        {status !== "archived" ? <DropdownMenuItem onClick={() => set("archived")}>Archive</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
