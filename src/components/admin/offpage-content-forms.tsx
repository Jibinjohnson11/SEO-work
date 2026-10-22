"use client"

import { useEffect, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { Eye, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, NativeSelect } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { ToneBadge } from "@/components/shared/status-badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { RICH_TEXT_CLASS, RichTextEditor } from "@/components/shared/rich-text-editor"
import { useAction } from "@/hooks/use-action"
import { CONTENT_TYPES, DECISION_LABEL, type ContentDecision, type ContentType, type ContentVersion, type OffpageContent } from "@/lib/offpage-content"
import { offpageContentSchema } from "@/lib/validation"
import { submitOffpageContent } from "@/server/offpage-content"

export interface ContentOptions {
  /** keywords: the campaign's primary and secondary keywords (primary first). */
  campaigns: { id: string; label: string; brand: string; type_ids: string[]; keywords: { id: string; keyword: string; primary: boolean }[] }[]
  types: { id: string; name: string }[]
}

const DECISION_TONE = { approved: "success", changes_requested: "warning", rejected: "danger" } as const

/** Backlink types offered for a campaign: its allowed types, or every active type when it has none. */
function typesFor(options: ContentOptions, campaignId: string) {
  const allowed = options.campaigns.find((c) => c.id === campaignId)?.type_ids ?? []
  return allowed.length ? options.types.filter((t) => allowed.includes(t.id)) : options.types
}

function ScopeFields({
  form,
  options,
  prefix,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
  options: ContentOptions
  prefix: string
}) {
  const e = form.formState.errors
  const campaignId: string = useWatch({ control: form.control, name: "campaign_id" })
  const campaign = options.campaigns.find((c) => c.id === campaignId)
  const keywords = campaign?.keywords ?? []
  const types = typesFor(options, campaignId)
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Field label="Campaign" required htmlFor={`${prefix}-campaign`} error={e.campaign_id?.message} hint={campaign ? `Brand: ${campaign.brand}` : undefined}>
        <NativeSelect
          id={`${prefix}-campaign`}
          {...form.register("campaign_id", {
            onChange: (ev: React.ChangeEvent<HTMLSelectElement>) => {
              // A keyword belongs to one campaign's list, so a new campaign always starts without one.
              form.setValue("keyword_id", "")
              const allowed = typesFor(options, ev.target.value)
              if (!allowed.some((t) => t.id === form.getValues("backlink_type_id"))) form.setValue("backlink_type_id", "")
            },
          })}
        >
          <option value="">{options.campaigns.length ? "Select campaign…" : "No campaigns available"}</option>
          {options.campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Target keyword" required htmlFor={`${prefix}-keyword`} error={e.keyword_id?.message}>
        <NativeSelect id={`${prefix}-keyword`} {...form.register("keyword_id")} disabled={!campaignId}>
          <option value="">{campaignId && keywords.length === 0 ? "No keywords on this campaign" : "Select keyword…"}</option>
          {keywords.some((k) => k.primary) ? (
            <optgroup label="Primary keyword">
              {keywords.filter((k) => k.primary).map((k) => <option key={k.id} value={k.id}>{k.keyword}</option>)}
            </optgroup>
          ) : null}
          {keywords.some((k) => !k.primary) ? (
            <optgroup label="Secondary keywords">
              {keywords.filter((k) => !k.primary).map((k) => <option key={k.id} value={k.id}>{k.keyword}</option>)}
            </optgroup>
          ) : null}
        </NativeSelect>
      </Field>
      <Field label="Backlink type" required htmlFor={`${prefix}-type`} error={e.backlink_type_id?.message}>
        <NativeSelect id={`${prefix}-type`} {...form.register("backlink_type_id")} disabled={!campaignId}>
          <option value="">Select backlink type…</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Content type" required htmlFor={`${prefix}-ctype`} error={e.content_type?.message}>
        <NativeSelect id={`${prefix}-ctype`} {...form.register("content_type")}>
          <option value="">Select content type…</option>
          {(Object.keys(CONTENT_TYPES) as ContentType[]).map((k) => <option key={k} value={k}>{CONTENT_TYPES[k]}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Content title" required htmlFor={`${prefix}-title`} error={e.title?.message} className="md:col-span-2 xl:col-span-4">
        <Input id={`${prefix}-title`} maxLength={200} placeholder="e.g. 10 ways small teams can use a CRM" {...form.register("title")} />
      </Field>
    </div>
  )
}

/**
 * New content form. Inline (no modal props) it resets after a submission; inside the Create New Content
 * modal it reports unsaved changes and closes through onDone / onCancel instead.
 */
export function ContentSubmitForm({
  options,
  onDone,
  onCancel,
  onDirtyChange,
}: {
  options: ContentOptions
  onDone?: () => void
  onCancel?: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { pending, execute } = useAction()
  const empty = { campaign_id: "", keyword_id: "", backlink_type_id: "", content_type: "" as ContentType, title: "", content_html: "" }
  const form = useForm<z.input<typeof offpageContentSchema>, unknown, z.output<typeof offpageContentSchema>>({
    resolver: zodResolver(offpageContentSchema),
    defaultValues: empty,
  })
  const e = form.formState.errors
  const dirty = form.formState.isDirty
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  const busy = pending || form.formState.isSubmitting
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (v) => {
        if (busy) return
        const r = await execute(() => submitOffpageContent(null, v))
        if (!r.ok) return
        if (onDone) onDone()
        else form.reset(empty)
      })}
    >
      <ScopeFields form={form} options={options} prefix="new" />
      <Field label="Content" required htmlFor="new-content" error={e.content_html?.message}>
        <Controller
          control={form.control}
          name="content_html"
          render={({ field }) => <RichTextEditor id="new-content" value={field.value} onChange={field.onChange} invalid={!!e.content_html} />}
        />
      </Field>
      {onCancel ? (
        // Pinned to the bottom of the scrolling modal so the actions stay reachable on long content.
        <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-col-reverse items-stretch gap-2 border-t bg-popover px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Goes straight to the client for approval.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit for Review"}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Goes straight to the client for approval.</p>
          <Button type="submit" disabled={busy} className="w-full sm:w-auto">{busy ? "Submitting…" : "Submit for Review"}</Button>
        </div>
      )}
    </form>
  )
}

/** "+ Create New Content": the new content form in a modal that guards unsaved work. */
export function CreateContentButton({ options }: { options: ContentOptions }) {
  const [open, setOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // Leaving the page (refresh, close tab) with unsaved content asks first.
  useEffect(() => {
    if (!open || !dirty) return
    const warn = (ev: BeforeUnloadEvent) => ev.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [open, dirty])

  function close() {
    setOpen(false)
    setDirty(false)
    setConfirmDiscard(false)
  }
  const requestClose = () => (dirty ? setConfirmDiscard(true) : close())

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Create New Content
      </Button>
      <FormDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : requestClose())} title="Create New Content" description="Campaign → Keyword → Backlink type → Content type → Title → Content → client approval" wide>
        {open ? <ContentSubmitForm options={options} onDone={close} onCancel={requestClose} onDirtyChange={setDirty} /> : null}
      </FormDialog>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this content?</AlertDialogTitle>
            <AlertDialogDescription>You have unsaved changes. Closing the form will lose them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={close}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function ContentRowActions({
  content,
  options,
  details,
  versions,
  decisions,
  canEdit,
}: {
  content: OffpageContent
  options: ContentOptions
  details: { label: string; value: string }[]
  versions: ContentVersion[]
  decisions: ContentDecision[]
  canEdit: boolean
}) {
  const [mode, setMode] = useState<"view" | "edit" | null>(null)
  const latest = decisions[0]
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="View content" onClick={() => setMode("view")}><Eye /></Button>
      {canEdit ? <Button variant="ghost" size="icon-sm" aria-label="Edit and resubmit" onClick={() => setMode("edit")}><Pencil /></Button> : null}
      <FormDialog open={mode === "view"} onOpenChange={(o) => setMode(o ? "view" : null)} title={content.title} description={`${content.code} · version ${content.current_version}`} wide>
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {details.map((d) => (
              <div key={d.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{d.label}</dt>
                <dd className="truncate">{d.value}</dd>
              </div>
            ))}
          </dl>
          {latest && latest.version === content.current_version && latest.feedback ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <span className="font-medium">{DECISION_LABEL[latest.decision]} — {latest.decided_by_name}{latest.is_admin_override ? " (admin override)" : ""}:</span> <span className="whitespace-pre-wrap">{latest.feedback}</span>
            </div>
          ) : null}
          <div className={`${RICH_TEXT_CLASS} max-h-[50vh] overflow-y-auto rounded-md border p-4`} dangerouslySetInnerHTML={{ __html: content.content_html }} />
          {versions.length > 1 || decisions.length ? (
            <details className="rounded-md border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">History ({versions.length} version{versions.length === 1 ? "" : "s"}, {decisions.length} decision{decisions.length === 1 ? "" : "s"})</summary>
              <ul className="mt-2 space-y-2">
                {versions.map((v) => (
                  <li key={v.version} className="border-t pt-2 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Version {v.version}</span>
                      <span className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
                      {v.version === content.approved_version ? <ToneBadge tone="success">Approved version</ToneBadge> : null}
                    </div>
                    {decisions.filter((d) => d.version === v.version).map((d, i) => (
                      <p key={i} className="mt-1 text-xs">
                        <ToneBadge tone={DECISION_TONE[d.decision]}>{DECISION_LABEL[d.decision]}</ToneBadge> {d.decided_by_name}{d.is_admin_override ? " (admin override)" : ""} · {new Date(d.created_at).toLocaleString()}
                        {d.feedback ? <span className="mt-0.5 block whitespace-pre-wrap text-muted-foreground">{d.feedback}</span> : null}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <FormActions>
          {canEdit ? <Button variant="outline" onClick={() => setMode("edit")}>Edit &amp; resubmit</Button> : null}
          <Button onClick={() => setMode(null)}>Close</Button>
        </FormActions>
      </FormDialog>
      {canEdit ? (
        <FormDialog open={mode === "edit"} onOpenChange={(o) => setMode(o ? "edit" : null)} title={`Edit ${content.code}`} description="Saving creates a new version and sends it to the client for approval." wide>
          {mode === "edit" ? <EditContentForm content={content} options={options} feedback={latest?.version === content.current_version ? latest.feedback : null} onDone={() => setMode(null)} /> : null}
        </FormDialog>
      ) : null}
    </div>
  )
}

function EditContentForm({ content, options, feedback, onDone }: { content: OffpageContent; options: ContentOptions; feedback: string | null; onDone: () => void }) {
  const { pending, execute } = useAction()
  const form = useForm<z.input<typeof offpageContentSchema>, unknown, z.output<typeof offpageContentSchema>>({
    resolver: zodResolver(offpageContentSchema),
    defaultValues: {
      campaign_id: content.campaign_id,
      keyword_id: content.keyword_id,
      backlink_type_id: content.backlink_type_id,
      content_type: content.content_type,
      title: content.title,
      content_html: content.content_html,
    },
  })
  const e = form.formState.errors
  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => { const r = await execute(() => submitOffpageContent(content.id, v)); if (r.ok) onDone() })}>
      {feedback ? <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm whitespace-pre-wrap"><span className="font-medium">Client feedback:</span> {feedback}</p> : null}
      <ScopeFields form={form} options={options} prefix="edit" />
      <Field label="Content" required htmlFor="edit-content" error={e.content_html?.message}>
        <Controller
          control={form.control}
          name="content_html"
          render={({ field }) => <RichTextEditor id="edit-content" value={field.value} onChange={field.onChange} invalid={!!e.content_html} />}
        />
      </Field>
      <FormActions>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Submitting…" : "Resubmit for approval"}</Button>
      </FormActions>
    </form>
  )
}
