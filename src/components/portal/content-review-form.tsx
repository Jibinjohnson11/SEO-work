"use client"

import { useState } from "react"
import { Check, CheckCircle2, PencilLine, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useAction } from "@/hooks/use-action"
import { contentAdminDecision, contentClientDecision } from "@/server/offpage-content"
import type { ReviewDecision } from "@/lib/types"
import { cn } from "@/lib/utils"

const OPTIONS: { value: ReviewDecision; label: string; hint: string; icon: typeof Check; tone: string }[] = [
  { value: "approved", label: "Approved", hint: "The content is ready. It becomes eligible for publication.", icon: Check, tone: "has-[:checked]:border-success has-[:checked]:bg-success/10 [&_svg]:text-success" },
  { value: "rejected", label: "Rejected", hint: "The content will not be used. Publication is blocked.", icon: X, tone: "has-[:checked]:border-destructive has-[:checked]:bg-destructive/10 [&_svg]:text-destructive" },
  { value: "changes_requested", label: "Needs Edit", hint: "The SEO team revises it and sends you a new version.", icon: PencilLine, tone: "has-[:checked]:border-warning has-[:checked]:bg-warning/10 [&_svg]:text-warning" },
]

const MAX_FEEDBACK = 5000

/**
 * The client's decision on the exact version shown above it: Approved, Rejected or Needs Edit.
 * `override`: a Super Admin records the decision instead of the client (a reason is always required).
 */
export function ContentReviewForm({ contentId, version, override = false }: { contentId: string; version: number; override?: boolean }) {
  const [decision, setDecision] = useState<ReviewDecision | null>(null)
  const [feedback, setFeedback] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)
  const { pending, execute } = useAction()
  const required = override || (decision !== null && decision !== "approved")
  const chosen = OPTIONS.find((o) => o.value === decision)

  const validate = () => {
    if (!decision) return "Select Approved, Rejected or Needs Edit."
    if (required && !feedback.trim())
      return override ? "Give the reason for overriding the client." : decision === "rejected" ? "Please give the reason for rejecting this content." : "Please describe what needs to change."
    return null
  }

  const submit = async () => {
    if (!decision || pending || done) return
    const input = { decision, feedback: feedback.trim(), version }
    const r = await execute(() => (override ? contentAdminDecision(contentId, input) : contentClientDecision(contentId, input)))
    setConfirming(false)
    if (r.ok) setDone(true)
  }

  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="font-medium">{override ? "Override recorded" : "Your review was submitted"}</p>
          <p className="text-muted-foreground">{override ? "The author and the client's approvers have been notified." : "The SEO team has been notified."} The status above updates in a moment.</p>
        </div>
      </div>
    )
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const problem = validate()
        setError(problem)
        if (!problem) setConfirming(true)
      }}
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{override ? `Decision on version ${version}, recorded as an admin override` : `Your decision on version ${version}`}</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                o.tone,
              )}
            >
              <input
                type="radio"
                name="decision"
                value={o.value}
                checked={decision === o.value}
                onChange={() => {
                  setDecision(o.value)
                  setError(null)
                }}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <o.icon className="size-4" aria-hidden /> {o.label}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="review-feedback" className="text-sm">
          {override ? "Override reason" : decision === "rejected" ? "Reason for rejection" : decision === "changes_requested" ? "What needs to change?" : "Feedback"}
          {required ? <span className="text-destructive"> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}
        </Label>
        <Textarea
          id="review-feedback"
          rows={5}
          maxLength={MAX_FEEDBACK}
          value={feedback}
          aria-invalid={Boolean(error && required && !feedback.trim())}
          placeholder={decision === "changes_requested" ? "Describe the edits you would like, e.g. sections to rewrite, facts to correct, tone…" : undefined}
          onChange={(e) => {
            setFeedback(e.target.value)
            setError(null)
          }}
        />
        <p className="text-right text-xs text-muted-foreground">{feedback.length} / {MAX_FEEDBACK}</p>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {override
            ? "Shown everywhere as an admin override, never as a client approval. The client is notified."
            : `Your decision applies only to version ${version}. If the content is revised, you will be asked to review the new version.`}
        </p>
        <Button type="submit" size="lg" disabled={pending} className="sm:min-w-40">
          {override ? "Record override" : "Submit Review"}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={(o) => !pending && setConfirming(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{override ? `Override with “${chosen?.label}” for version ${version}?` : `Submit “${chosen?.label}” for version ${version}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {decision === "approved"
                ? "The content will be marked approved and can move on to publication."
                : decision === "rejected"
                  ? "The content will be rejected and will not be published."
                  : "The content goes back to the SEO team with your feedback. You will review the revised version."}{" "}
              A decision cannot be changed once submitted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {feedback.trim() ? <p className="max-h-40 overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{feedback.trim()}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button variant={decision === "rejected" ? "destructive" : "default"} disabled={pending} onClick={submit}>
              {pending ? "Submitting…" : "Confirm and submit"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
