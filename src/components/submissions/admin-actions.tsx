"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { Archive, Pencil, Send, ShieldAlert, UserRoundCog, Eye, CheckCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmAction } from "@/components/shared/confirm-action"
import { Field, NativeSelect } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { useAction } from "@/hooks/use-action"
import { adminEditSubmission, adminOverride, archiveSubmission, markReady, reassignSubmission, sendToClient, startReview } from "@/server/workflow"
import type { SubmissionAction } from "@/lib/workflow"
import type { Submission } from "@/lib/types"

export function AdminActions({ submission, actions, interns }: { submission: Submission; actions: SubmissionAction[]; interns: { id: string; label: string }[] }) {
  const id = submission.id
  return (
    <div className="flex flex-wrap gap-2">
      {actions.includes("start_review") ? <ConfirmAction title="Start internal review?" description="Marks the submission as under review and notifies nobody." onConfirm={() => startReview(id)} variant="outline"><Eye /> Start review</ConfirmAction> : null}
      {actions.includes("send_to_client") ? <ConfirmAction title="Send to client for approval?" description={`The client's approvers will be notified and asked to review version ${submission.current_version}.`} onConfirm={() => sendToClient(id)} variant="default"><Send /> Send to client</ConfirmAction> : null}
      {actions.includes("mark_ready") ? <ConfirmAction title="Mark ready for publication?" onConfirm={() => markReady(id)} variant="outline"><CheckCheck /> Mark ready</ConfirmAction> : null}
      {actions.includes("admin_edit") ? <EditContentButton submission={submission} /> : null}
      {actions.includes("reassign") ? <ReassignButton id={id} interns={interns.filter((i) => i.id !== submission.intern_id)} /> : null}
      {actions.includes("override") ? (
        <ConfirmAction
          title="Override client approval?"
          description="This proceeds WITHOUT the client's approval. It is recorded and shown as an admin override — never as a client decision — and the client is notified."
          reason={{ label: "Reason for override", required: true }}
          destructive
          confirmLabel="Override and proceed"
          onConfirm={(r) => adminOverride(id, r)}
          variant="ghost"
        >
          <ShieldAlert /> Admin override
        </ConfirmAction>
      ) : null}
      {actions.includes("archive") ? (
        <ConfirmAction title="Archive submission?" description="It stays in history and reports but leaves all queues." reason={{ label: "Reason (optional)" }} confirmLabel="Archive" onConfirm={(r) => archiveSubmission(id, r)} variant="ghost">
          <Archive /> Archive
        </ConfirmAction>
      ) : null}
    </div>
  )
}

function ReassignButton({ id, interns }: { id: string; interns: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const [intern, setIntern] = useState("")
  const [note, setNote] = useState("")
  const { pending, execute } = useAction()
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><UserRoundCog /> Reassign</Button>
      <FormDialog open={open} onOpenChange={setOpen} title="Reassign submission" description="The new intern is assigned to the campaign if needed and asked to revise the work.">
        <div className="space-y-4">
          <Field label="Intern" required htmlFor="ra-intern">
            <NativeSelect id="ra-intern" value={intern} onChange={(e) => setIntern(e.target.value)}>
              <option value="">Choose…</option>
              {interns.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Note" htmlFor="ra-note"><Textarea id="ra-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <FormActions>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!intern || pending} onClick={async () => { const r = await execute(() => reassignSubmission(id, intern, note)); if (r.ok) setOpen(false) }}>Reassign</Button>
          </FormActions>
        </div>
      </FormDialog>
    </>
  )
}

function EditContentButton({ submission }: { submission: Submission }) {
  const [open, setOpen] = useState(false)
  const { pending, execute } = useAction()
  const form = useForm({
    defaultValues: {
      proposed_website: submission.proposed_website,
      placement_url: submission.placement_url ?? "",
      target_url: submission.target_url,
      anchor_text: submission.anchor_text ?? "",
      content_title: submission.content_title ?? "",
      content_draft: submission.content_draft ?? "",
      notes: submission.notes ?? "",
      link_attribute: (submission.link_attribute ?? "") as "" | "dofollow" | "nofollow" | "sponsored" | "ugc" | "unknown",
      change_summary: "",
    },
  })
  const approved = ["client_approved", "ready_for_publication"].includes(submission.status)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Pencil /> Edit content</Button>
      <FormDialog open={open} onOpenChange={setOpen} title={`Edit ${submission.code}`} description={approved ? "Material changes to approved content create a new version and send it back to the client for re-approval (per workflow settings)." : "Material changes create a new version in the history."} wide>
        <form className="space-y-4" onSubmit={form.handleSubmit(async (v) => { const r = await execute(() => adminEditSubmission(submission.id, v)); if (r.ok) setOpen(false) })}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Proposed website" htmlFor="e-site"><Input id="e-site" {...form.register("proposed_website")} /></Field>
            <Field label="Placement URL" htmlFor="e-place"><Input id="e-place" {...form.register("placement_url")} /></Field>
            <Field label="Target URL" htmlFor="e-target"><Input id="e-target" {...form.register("target_url")} /></Field>
            <Field label="Anchor text" htmlFor="e-anchor"><Input id="e-anchor" {...form.register("anchor_text")} /></Field>
          </div>
          <Field label="Content title" htmlFor="e-title"><Input id="e-title" {...form.register("content_title")} /></Field>
          <Field label="Content draft" htmlFor="e-draft"><Textarea id="e-draft" rows={10} {...form.register("content_draft")} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Internal notes" htmlFor="e-notes"><Textarea id="e-notes" rows={2} {...form.register("notes")} /></Field>
            <Field label="Change summary" htmlFor="e-summary" hint="Shown in version history"><Textarea id="e-summary" rows={2} {...form.register("change_summary")} /></Field>
          </div>
          <FormActions>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
          </FormActions>
        </form>
      </FormDialog>
    </>
  )
}
