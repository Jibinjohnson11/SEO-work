"use client"

import { useState } from "react"
import { Stethoscope } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Field, SwitchField } from "@/components/shared/form"
import { useAction } from "@/hooks/use-action"
import { internalDecision } from "@/server/workflow"
import type { ReviewDecision } from "@/lib/types"

const BASE_CHECKS = ["Relevant to the campaign and keyword", "Target URL is correct", "Anchor text is natural and appropriate", "Proposed website is legitimate (no link farms / PBNs)", "Supporting evidence reviewed"]

export function ReviewPanel({
  submissionId,
  typeChecklist,
  isMedical,
  medicalChecklist,
  requireClientApproval,
  reviewerName,
  today,
}: {
  submissionId: string
  typeChecklist: string[]
  isMedical: boolean
  medicalChecklist: string[]
  requireClientApproval: boolean
  reviewerName: string
  today: string
}) {
  const checks = [...BASE_CHECKS, ...typeChecklist]
  const [decision, setDecision] = useState<ReviewDecision>("approved")
  const [comments, setComments] = useState("")
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [forward, setForward] = useState(requireClientApproval)
  const [medical, setMedical] = useState({
    medical_accuracy_reviewed: false,
    medical_reviewer_name: reviewerName,
    medical_reviewer_qualification: "",
    claims_verified: false,
    sources_checked: false,
    compliance_notes: "",
    medical_review_date: today,
  })
  const [medicalItems, setMedicalItems] = useState<Record<string, boolean>>({})
  const { pending, execute } = useAction()

  const medicalComplete = medical.medical_accuracy_reviewed && medical.claims_verified && medical.sources_checked && medical.medical_reviewer_name.trim()
  const blocked = (decision !== "approved" && !comments.trim()) || (decision === "approved" && isMedical && !medicalComplete)

  return (
    <div className="space-y-4">
      <RadioGroup value={decision} onValueChange={(v) => setDecision(v as ReviewDecision)} className="grid gap-2 sm:grid-cols-3">
        {([
          ["approved", "Approve internally"],
          ["changes_requested", "Request changes"],
          ["rejected", "Reject"],
        ] as const).map(([v, l]) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-data-checked:border-primary has-data-checked:bg-accent/50">
            <RadioGroupItem value={v} /> {l}
          </label>
        ))}
      </RadioGroup>

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium">Quality checklist</legend>
        {checks.map((c) => (
          <label key={c} className="flex items-center gap-2 text-sm">
            <Checkbox checked={Boolean(checked[c])} onCheckedChange={(v) => setChecked({ ...checked, [c]: Boolean(v) })} /> {c}
          </label>
        ))}
      </fieldset>

      {isMedical ? (
        <fieldset className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-50/50 p-3 dark:bg-amber-500/5">
          <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <Stethoscope className="size-3.5" /> Medical content review (required to approve)
          </legend>
          {medicalChecklist.length ? (
            <div className="space-y-1.5">
              {medicalChecklist.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={Boolean(medicalItems[c])} onCheckedChange={(v) => setMedicalItems({ ...medicalItems, [c]: Boolean(v) })} /> {c}
                </label>
              ))}
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ["medical_accuracy_reviewed", "Medical accuracy reviewed"],
              ["claims_verified", "Claims verified"],
              ["sources_checked", "Sources checked"],
            ] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={medical[k]} onCheckedChange={(v) => setMedical({ ...medical, [k]: Boolean(v) })} /> {l}
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Reviewer name" required htmlFor="m-name"><Input id="m-name" value={medical.medical_reviewer_name} onChange={(e) => setMedical({ ...medical, medical_reviewer_name: e.target.value })} /></Field>
            <Field label="Qualification (if applicable)" htmlFor="m-qual"><Input id="m-qual" placeholder="e.g. BDS, MD" value={medical.medical_reviewer_qualification} onChange={(e) => setMedical({ ...medical, medical_reviewer_qualification: e.target.value })} /></Field>
            <Field label="Review date" htmlFor="m-date"><Input id="m-date" type="date" value={medical.medical_review_date} onChange={(e) => setMedical({ ...medical, medical_review_date: e.target.value })} /></Field>
          </div>
          <Field label="Compliance notes" htmlFor="m-notes"><Textarea id="m-notes" rows={2} value={medical.compliance_notes} onChange={(e) => setMedical({ ...medical, compliance_notes: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">Nothing here is filled automatically. Only confirm what a person actually reviewed.</p>
        </fieldset>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="review-comments" className="text-xs">
          Feedback for the intern {decision !== "approved" ? <span className="text-destructive">*</span> : null}
        </Label>
        <Textarea id="review-comments" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} placeholder={decision === "approved" ? "Optional" : "Explain what needs to change"} />
      </div>

      {decision === "approved" && requireClientApproval ? (
        <SwitchField label="Send to client for approval now" description="Otherwise it waits in Internally Approved until you forward it." checked={forward} onCheckedChange={setForward} />
      ) : null}

      <div className="flex justify-end">
        <Button
          disabled={pending || Boolean(blocked)}
          variant={decision === "rejected" ? "destructive" : "default"}
          onClick={() =>
            execute(() =>
              internalDecision(submissionId, {
                decision,
                comments: comments.trim(),
                checklist: { ...checked, ...Object.fromEntries(Object.entries(medicalItems).map(([k, v]) => [`medical: ${k}`, v])) },
                forward_to_client: decision === "approved" && forward,
                medical: isMedical ? medical : null,
              }),
            )
          }
        >
          {pending ? "Saving…" : decision === "approved" ? "Approve" : decision === "rejected" ? "Reject" : "Request changes"}
        </Button>
      </div>
    </div>
  )
}
