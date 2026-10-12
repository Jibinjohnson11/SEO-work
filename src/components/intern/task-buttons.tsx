"use client"

import { LinkButton } from "@/components/ui/link-button"
import { Button } from "@/components/ui/button"
import { useAction } from "@/hooks/use-action"
import { setMyTaskStatus } from "@/server/workflow"
import type { TaskStatus } from "@/lib/types"

export function InternTaskButtons({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const { pending, execute } = useAction()
  if (status === "completed" || status === "cancelled") return null
  return (
    <span className="flex flex-wrap justify-end gap-1">
      <LinkButton size="xs" variant="default" href={`/intern/submissions/new?task=${taskId}`}>New submission</LinkButton>
      {status === "not_started" ? <Button size="xs" variant="outline" disabled={pending} onClick={() => execute(() => setMyTaskStatus(taskId, "in_progress"))}>Start</Button> : null}
      {status === "in_progress" || status === "changes_requested" ? <Button size="xs" variant="outline" disabled={pending} onClick={() => execute(() => setMyTaskStatus(taskId, "submitted"))}>Mark submitted</Button> : null}
    </span>
  )
}
