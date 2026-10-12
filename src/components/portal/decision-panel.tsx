"use client"

import { useState } from "react"
import { Check, MessageSquareWarning, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAction } from "@/hooks/use-action"
import { clientDecision } from "@/server/workflow"
import type { ReviewDecision } from "@/lib/types"

export function DecisionPanel({ submissionId, version }: { submissionId: string; version: number }) {
  const [mode, setMode] = useState<ReviewDecision | null>(null)
  const [feedback, setFeedback] = useState("")
  const { pending, execute } = useAction()
  const send = (decision: ReviewDecision) => execute(() => clientDecision(submissionId, { decision, feedback: feedback.trim(), version }))
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">You are reviewing <strong>version {version}</strong>. If the agency changes the content later, you will be asked to approve the new version.</p>
      {mode && mode !== "approved" ? (
        <div className="space-y-2">
          <Label htmlFor="feedback" className="text-xs">{mode === "rejected" ? "Reason for rejection" : "What should change?"} <span className="text-destructive">*</span></Label>
          <Textarea id="feedback" rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMode(null)} disabled={pending}>Back</Button>
            <Button variant={mode === "rejected" ? "destructive" : "default"} disabled={pending || !feedback.trim()} onClick={() => send(mode)}>
              {pending ? "Sending…" : mode === "rejected" ? "Reject" : "Request changes"}
            </Button>
          </div>
        </div>
      ) : mode === "approved" ? (
        <div className="space-y-2">
          <Label htmlFor="approve-note" className="text-xs">Comment (optional)</Label>
          <Textarea id="approve-note" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMode(null)} disabled={pending}>Back</Button>
            <Button disabled={pending} onClick={() => send("approved")}>{pending ? "Approving…" : `Approve version ${version}`}</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <Button onClick={() => setMode("approved")}><Check /> Approve</Button>
          <Button variant="outline" onClick={() => setMode("changes_requested")}><MessageSquareWarning /> Request changes</Button>
          <Button variant="destructive" onClick={() => setMode("rejected")}><X /> Reject</Button>
        </div>
      )}
    </div>
  )
}
