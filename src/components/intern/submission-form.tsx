"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, NativeSelect } from "@/components/shared/form"
import { Section } from "@/components/shared/page-header"
import { useAction } from "@/hooks/use-action"
import { submissionSchema } from "@/lib/validation"
import { humanize } from "@/lib/workflow"
import { saveSubmission } from "@/server/workflow"
import type { Submission } from "@/lib/types"

type Values = z.input<typeof submissionSchema>

export interface InternFormOptions {
  campaigns: { id: string; label: string; target_url: string | null; type_ids: string[]; keywords: { id: string; keyword: string; target_url: string | null }[] }[]
  types: { id: string; name: string; required_fields: string[]; description: string }[]
  tasks: { id: string; label: string; campaign_id: string; keyword_id: string | null; backlink_type_id: string | null }[]
}

export function SubmissionForm({ options, submission, preset }: { options: InternFormOptions; submission?: Submission; preset?: { campaign_id?: string; task_id?: string } }) {
  const router = useRouter()
  const { pending, execute } = useAction()
  const presetTask = options.tasks.find((t) => t.id === preset?.task_id)
  const initialCampaign = submission?.campaign_id ?? presetTask?.campaign_id ?? preset?.campaign_id ?? ""
  const c0 = options.campaigns.find((c) => c.id === initialCampaign)
  const form = useForm<Values, unknown, z.output<typeof submissionSchema>>({
    resolver: zodResolver(submissionSchema),
    defaultValues: {
      campaign_id: initialCampaign,
      backlink_type_id: submission?.backlink_type_id ?? presetTask?.backlink_type_id ?? "",
      keyword_id: submission?.keyword_id ?? presetTask?.keyword_id ?? "",
      task_id: submission?.task_id ?? presetTask?.id ?? "",
      proposed_website: submission?.proposed_website ?? "",
      placement_url: submission?.placement_url ?? "",
      target_url: submission?.target_url ?? c0?.keywords.find((k) => k.id === presetTask?.keyword_id)?.target_url ?? c0?.target_url ?? "",
      anchor_text: submission?.anchor_text ?? "",
      content_title: submission?.content_title ?? "",
      content_draft: submission?.content_draft ?? "",
      notes: submission?.notes ?? "",
      domain_rating: submission?.domain_rating ?? "",
      domain_authority: submission?.domain_authority ?? "",
      estimated_traffic: submission?.estimated_traffic ?? "",
      website_relevance: submission?.website_relevance ?? "",
      outreach_contact: submission?.outreach_contact ?? "",
      outreach_status: submission?.outreach_status ?? "",
      link_attribute: submission?.link_attribute ?? "",
      change_summary: "",
    },
  })
  const e = form.formState.errors
  const campaignId = useWatch({ control: form.control, name: "campaign_id" })
  const typeId = useWatch({ control: form.control, name: "backlink_type_id" })
  const campaign = options.campaigns.find((c) => c.id === campaignId)
  const allowedTypes = useMemo(() => options.types.filter((t) => !campaign || campaign.type_ids.length === 0 || campaign.type_ids.includes(t.id)), [options.types, campaign])
  const required = new Set(options.types.find((t) => t.id === typeId)?.required_fields ?? [])
  const tasks = options.tasks.filter((t) => t.campaign_id === campaignId)
  const isRevision = Boolean(submission && submission.status !== "draft")

  const submit = (doSubmit: boolean) =>
    form.handleSubmit(async (v) => {
      const missing = doSubmit ? [...required].filter((f) => !String(v[f as keyof typeof v] ?? "").trim()) : []
      if (missing.length) {
        for (const f of missing) form.setError(f as keyof Values, { message: `Required for this backlink type` })
        return
      }
      const r = await execute(() => saveSubmission(submission?.id ?? null, v, doSubmit))
      if (r.ok && r.data) router.push(`/intern/submissions/${r.data}`)
    })

  const req = (f: string) => required.has(f)
  return (
    <form noValidate className="space-y-6" onSubmit={(ev) => ev.preventDefault()}>
      <Section title="Assignment">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Campaign" required error={e.campaign_id?.message} htmlFor="campaign_id">
            <NativeSelect id="campaign_id" disabled={Boolean(submission)} {...form.register("campaign_id", { onChange: (ev) => {
              const c = options.campaigns.find((x) => x.id === ev.target.value)
              form.setValue("keyword_id", ""); form.setValue("task_id", ""); form.setValue("backlink_type_id", "")
              if (c?.target_url && !form.getValues("target_url")) form.setValue("target_url", c.target_url)
            } })}>
              <option value="">Choose a campaign…</option>
              {options.campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Backlink type" required error={e.backlink_type_id?.message} htmlFor="backlink_type_id" hint={options.types.find((t) => t.id === typeId)?.description}>
            <NativeSelect id="backlink_type_id" {...form.register("backlink_type_id")}>
              <option value="">Choose a type…</option>
              {allowedTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Keyword" htmlFor="keyword_id">
            <NativeSelect id="keyword_id" {...form.register("keyword_id", { onChange: (ev) => { const k = campaign?.keywords.find((x) => x.id === ev.target.value); if (k?.target_url) form.setValue("target_url", k.target_url) } })}>
              <option value="">—</option>
              {campaign?.keywords.map((k) => <option key={k.id} value={k.id}>{k.keyword}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Task" htmlFor="task_id">
            <NativeSelect id="task_id" {...form.register("task_id")}>
              <option value="">Not linked to a task</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </NativeSelect>
          </Field>
        </div>
        {required.size ? <p className="mt-3 text-xs text-muted-foreground">This type requires: {[...required].map(humanize).join(", ")}.</p> : null}
      </Section>

      <Section title="Opportunity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proposed website" required error={e.proposed_website?.message} htmlFor="proposed_website"><Input id="proposed_website" placeholder="publisher.com" {...form.register("proposed_website")} /></Field>
          <Field label="Proposed placement URL" required={req("placement_url")} error={e.placement_url?.message} htmlFor="placement_url"><Input id="placement_url" placeholder="https://publisher.com/page" {...form.register("placement_url")} /></Field>
          <Field label="Target URL" required error={e.target_url?.message} htmlFor="target_url"><Input id="target_url" {...form.register("target_url")} /></Field>
          <Field label="Anchor text" required={req("anchor_text")} error={e.anchor_text?.message} htmlFor="anchor_text"><Input id="anchor_text" {...form.register("anchor_text")} /></Field>
          <Field label="Expected link attribute" htmlFor="link_attribute">
            <NativeSelect id="link_attribute" {...form.register("link_attribute")}><option value="">Unknown</option>{["dofollow", "nofollow", "sponsored", "ugc"].map((a) => <option key={a} value={a}>{a}</option>)}</NativeSelect>
          </Field>
          <Field label="Website relevance" required={req("website_relevance")} error={e.website_relevance?.message} htmlFor="website_relevance"><Input id="website_relevance" placeholder="Why this site fits the client" {...form.register("website_relevance")} /></Field>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">Optional metrics & outreach</summary>
          <p className="mt-2 text-xs text-muted-foreground">Third-party metrics (DR, DA, traffic) are informational estimates, not Google ranking signals.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label="Domain rating" error={e.domain_rating?.message} htmlFor="domain_rating"><Input id="domain_rating" type="number" min={0} max={100} step="0.1" {...form.register("domain_rating")} /></Field>
            <Field label="Domain authority" error={e.domain_authority?.message} htmlFor="domain_authority"><Input id="domain_authority" type="number" min={0} max={100} step="0.1" {...form.register("domain_authority")} /></Field>
            <Field label="Estimated traffic" error={e.estimated_traffic?.message} htmlFor="estimated_traffic"><Input id="estimated_traffic" type="number" min={0} {...form.register("estimated_traffic")} /></Field>
            <Field label="Outreach contact" required={req("outreach_contact")} error={e.outreach_contact?.message} htmlFor="outreach_contact"><Input id="outreach_contact" placeholder="Editor name / email" {...form.register("outreach_contact")} /></Field>
            <Field label="Outreach status" htmlFor="outreach_status">
              <NativeSelect id="outreach_status" {...form.register("outreach_status")}><option value="">—</option>{["not_contacted", "contacted", "follow_up", "negotiating", "accepted", "declined"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</NativeSelect>
            </Field>
          </div>
        </details>
      </Section>

      <Section title="Content" description="Required for content-based placements such as guest posts">
        <div className="space-y-4">
          <Field label="Content title" required={req("content_title")} error={e.content_title?.message} htmlFor="content_title"><Input id="content_title" {...form.register("content_title")} /></Field>
          <Field label="Content draft" required={req("content_draft")} error={e.content_draft?.message} htmlFor="content_draft"><Textarea id="content_draft" rows={14} className="font-[inherit] leading-relaxed" {...form.register("content_draft")} /></Field>
          <Field label="Notes for the reviewer" htmlFor="notes"><Textarea id="notes" rows={3} {...form.register("notes")} /></Field>
          {isRevision ? <Field label="What changed in this revision?" htmlFor="change_summary"><Input id="change_summary" {...form.register("change_summary")} /></Field> : null}
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button type="button" variant="outline" disabled={pending} onClick={submit(false)}>Save draft</Button>
        <Button type="button" disabled={pending} onClick={submit(true)}>{pending ? "Saving…" : isRevision ? "Resubmit revision" : "Submit for review"}</Button>
      </div>
    </form>
  )
}
