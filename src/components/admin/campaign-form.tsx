"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CheckboxGroup, Field, NativeSelect } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { useAction } from "@/hooks/use-action"
import { campaignSchema, dbToTristate } from "@/lib/validation"
import { saveCampaign } from "@/server/admin/campaigns"
import type { Campaign } from "@/lib/types"

type Values = z.input<typeof campaignSchema>

export interface CampaignFormOptions {
  clients: { id: string; label: string }[]
  keywords: { id: string; keyword: string; client_id: string }[]
  interns: { id: string; label: string }[]
  types: { id: string; name: string }[]
  defaults: { daily_target: number; weekly_target: number; monthly_target: number; priority: string }
}

export interface CampaignRelations {
  keyword_ids: string[]
  primary_keyword_id: string
  intern_ids: string[]
  backlink_type_ids: string[]
}

export function CampaignFormButton({
  campaign,
  relations,
  options,
  presetClientId,
  children,
  variant = "default",
}: {
  campaign?: Campaign
  relations?: CampaignRelations
  options: CampaignFormOptions
  presetClientId?: string
  children: React.ReactNode
  variant?: "default" | "outline"
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <FormDialog open={open} onOpenChange={setOpen} title={campaign ? `Edit ${campaign.code}` : "New campaign"} wide>
        {open ? <CampaignForm campaign={campaign} relations={relations} options={options} presetClientId={presetClientId} onDone={() => setOpen(false)} /> : null}
      </FormDialog>
    </>
  )
}

function CampaignForm({ campaign, relations, options, presetClientId, onDone }: { campaign?: Campaign; relations?: CampaignRelations; options: CampaignFormOptions; presetClientId?: string; onDone: () => void }) {
  const router = useRouter()
  const { pending, execute } = useAction()
  const form = useForm<Values, unknown, z.output<typeof campaignSchema>>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: campaign?.name ?? "",
      client_id: campaign?.client_id ?? presetClientId ?? "",
      description: campaign?.description ?? "",
      target_url: campaign?.target_url ?? "",
      priority: campaign?.priority ?? (options.defaults.priority as Values["priority"]),
      start_date: campaign?.start_date ?? "",
      end_date: campaign?.end_date ?? "",
      daily_target: campaign?.daily_target ?? options.defaults.daily_target,
      weekly_target: campaign?.weekly_target ?? options.defaults.weekly_target,
      monthly_target: campaign?.monthly_target ?? options.defaults.monthly_target,
      status: campaign?.status ?? "draft",
      is_medical: dbToTristate(campaign?.is_medical ?? null),
      require_internal_review: dbToTristate(campaign?.require_internal_review ?? null),
      require_client_approval: dbToTristate(campaign?.require_client_approval ?? null),
      internal_notes: campaign?.internal_notes ?? "",
      primary_keyword_id: relations?.primary_keyword_id ?? "",
      keyword_ids: relations?.keyword_ids ?? [],
      intern_ids: relations?.intern_ids ?? [],
      backlink_type_ids: relations?.backlink_type_ids ?? [],
    },
  })
  const e = form.formState.errors
  const clientId = form.watch("client_id")
  const clientKeywords = useMemo(() => options.keywords.filter((k) => k.client_id === clientId), [options.keywords, clientId])

  const tristate = (name: "is_medical" | "require_internal_review" | "require_client_approval", label: string) => (
    <Field label={label} htmlFor={name}>
      <NativeSelect id={name} {...form.register(name)}>
        <option value="inherit">Use client setting</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </NativeSelect>
    </Field>
  )

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={form.handleSubmit(async (v) => {
        const r = await execute(() => saveCampaign(campaign?.id ?? null, v))
        if (r.ok) {
          onDone()
          if (!campaign && r.data) router.push(`/admin/campaigns/${r.data}`)
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Campaign name" required error={e.name?.message} htmlFor="name">
          <Input id="name" {...form.register("name")} />
        </Field>
        <Field label="Client" required error={e.client_id?.message} htmlFor="client_id">
          <NativeSelect
            id="client_id"
            {...form.register("client_id", {
              onChange: () => {
                form.setValue("keyword_ids", [])
                form.setValue("primary_keyword_id", "")
              },
            })}
            disabled={Boolean(campaign)}
          >
            <option value="">Choose a client…</option>
            {options.clients.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Target URL" error={e.target_url?.message} htmlFor="target_url" className="sm:col-span-2">
          <Input id="target_url" placeholder="https://client.com/landing-page" {...form.register("target_url")} />
        </Field>
        <Field label="Status" htmlFor="status">
          <NativeSelect id="status" {...form.register("status")}>
            {["draft", "active", "paused", "completed", "archived"].map((s) => (
              <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Priority" htmlFor="priority">
          <NativeSelect id="priority" {...form.register("priority")}>
            {["low", "medium", "high", "urgent"].map((s) => (
              <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Start date" htmlFor="start_date" error={e.start_date?.message}>
          <Input id="start_date" type="date" {...form.register("start_date")} />
        </Field>
        <Field label="End date / deadline" htmlFor="end_date" error={e.end_date?.message}>
          <Input id="end_date" type="date" {...form.register("end_date")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Daily backlink target" htmlFor="daily_target" error={e.daily_target?.message}>
          <Input id="daily_target" type="number" min={0} {...form.register("daily_target")} />
        </Field>
        <Field label="Weekly target" htmlFor="weekly_target" error={e.weekly_target?.message}>
          <Input id="weekly_target" type="number" min={0} {...form.register("weekly_target")} />
        </Field>
        <Field label="Monthly target" htmlFor="monthly_target" error={e.monthly_target?.message}>
          <Input id="monthly_target" type="number" min={0} {...form.register("monthly_target")} />
        </Field>
      </div>
      <Field label="Description" htmlFor="description">
        <Textarea id="description" rows={2} {...form.register("description")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Primary keyword" htmlFor="primary_keyword_id" hint={clientId ? `${clientKeywords.length} keywords for this client` : "Choose a client first"}>
          <NativeSelect id="primary_keyword_id" {...form.register("primary_keyword_id")} disabled={!clientId}>
            <option value="">None</option>
            {clientKeywords.map((k) => (
              <option key={k.id} value={k.id}>{k.keyword}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Secondary keywords">
          <Controller control={form.control} name="keyword_ids" render={({ field }) => (
            <CheckboxGroup options={clientKeywords.map((k) => ({ value: k.id, label: k.keyword }))} value={field.value} onChange={field.onChange} searchable emptyText="Add keywords for this client on the Keywords page." />
          )} />
        </Field>
        <Field label="Assigned interns">
          <Controller control={form.control} name="intern_ids" render={({ field }) => (
            <CheckboxGroup options={options.interns.map((i) => ({ value: i.id, label: i.label }))} value={field.value} onChange={field.onChange} searchable emptyText="Invite interns first." />
          )} />
        </Field>
        <Field label="Allowed backlink types" hint="None selected = all active types allowed">
          <Controller control={form.control} name="backlink_type_ids" render={({ field }) => (
            <CheckboxGroup options={options.types.map((t) => ({ value: t.id, label: t.name }))} value={field.value} onChange={field.onChange} />
          )} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {tristate("is_medical", "Medical content review")}
        {tristate("require_internal_review", "Internal review")}
        {tristate("require_client_approval", "Client approval")}
      </div>
      <Field label="Internal notes" hint="Visible to the team, never to the client" htmlFor="internal_notes">
        <Textarea id="internal_notes" rows={2} {...form.register("internal_notes")} />
      </Field>
      <FormActions>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : campaign ? "Save changes" : "Create campaign"}</Button>
      </FormActions>
    </form>
  )
}
