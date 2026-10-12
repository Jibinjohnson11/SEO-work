"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, NativeSelect, SwitchField } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { useAction } from "@/hooks/use-action"
import { clientSchema } from "@/lib/validation"
import { TIMEZONES } from "@/lib/timezones"
import { saveClient } from "@/server/admin/clients"
import type { Client } from "@/lib/types"

type Values = z.input<typeof clientSchema>

export function ClientFormButton({
  client,
  defaults,
  children,
  variant = "default",
}: {
  client?: Client
  defaults: { timezone: string; internal_review_required: boolean; client_approval_required: boolean; reapproval_on_material_change: boolean }
  children: React.ReactNode
  variant?: "default" | "outline"
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        {children}
      </Button>
      <FormDialog open={open} onOpenChange={setOpen} title={client ? `Edit ${client.company_name}` : "New client"} wide>
        {open ? <ClientForm client={client} defaults={defaults} onDone={() => setOpen(false)} /> : null}
      </FormDialog>
    </>
  )
}

function ClientForm({ client, defaults, onDone }: { client?: Client; defaults: Parameters<typeof ClientFormButton>[0]["defaults"]; onDone: () => void }) {
  const router = useRouter()
  const { pending, execute } = useAction()
  const form = useForm<Values, unknown, z.output<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      company_name: client?.company_name ?? "",
      website_url: client?.website_url ?? "",
      industry: client?.industry ?? "",
      contact_person: client?.contact_person ?? "",
      contact_email: client?.contact_email ?? "",
      contact_phone: client?.contact_phone ?? "",
      country: client?.country ?? "",
      timezone: client?.timezone ?? defaults.timezone,
      start_date: client?.start_date ?? "",
      status: client?.status ?? "active",
      notes: client?.notes ?? "",
      is_medical: client?.is_medical ?? false,
      require_internal_review: client?.require_internal_review ?? defaults.internal_review_required,
      require_client_approval: client?.require_client_approval ?? defaults.client_approval_required,
      reapproval_on_material_change: client?.reapproval_on_material_change ?? defaults.reapproval_on_material_change,
    },
  })
  const e = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const r = await execute(() => saveClient(client?.id ?? null, values))
    if (r.ok) {
      onDone()
      if (!client && r.data) router.push(`/admin/clients/${r.data}`)
    }
  })
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" required error={e.company_name?.message} htmlFor="company_name">
          <Input id="company_name" {...form.register("company_name")} aria-invalid={!!e.company_name} />
        </Field>
        <Field label="Website URL" error={e.website_url?.message} htmlFor="website_url">
          <Input id="website_url" placeholder="https://" {...form.register("website_url")} aria-invalid={!!e.website_url} />
        </Field>
        <Field label="Industry" htmlFor="industry">
          <Input id="industry" placeholder="e.g. Dental clinic" {...form.register("industry")} />
        </Field>
        <Field label="Status" htmlFor="status">
          <NativeSelect id="status" {...form.register("status")}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </NativeSelect>
        </Field>
        <Field label="Contact person" htmlFor="contact_person">
          <Input id="contact_person" {...form.register("contact_person")} />
        </Field>
        <Field label="Contact email" error={e.contact_email?.message} htmlFor="contact_email">
          <Input id="contact_email" type="email" {...form.register("contact_email")} aria-invalid={!!e.contact_email} />
        </Field>
        <Field label="Contact number" htmlFor="contact_phone">
          <Input id="contact_phone" {...form.register("contact_phone")} />
        </Field>
        <Field label="Country" htmlFor="country">
          <Input id="country" {...form.register("country")} />
        </Field>
        <Field label="Time zone" hint="Used for this client's reports" error={e.timezone?.message} htmlFor="timezone">
          <NativeSelect id="timezone" {...form.register("timezone")}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Start date" htmlFor="start_date" error={e.start_date?.message}>
          <Input id="start_date" type="date" {...form.register("start_date")} />
        </Field>
      </div>
      <Field label="Internal notes" hint="Never shown to the client" htmlFor="notes">
        <Textarea id="notes" rows={3} {...form.register("notes")} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Controller control={form.control} name="is_medical" render={({ field }) => (
          <SwitchField label="Medical / healthcare client" description="Requires the medical review checklist before internal approval" checked={field.value} onCheckedChange={field.onChange} />
        )} />
        <Controller control={form.control} name="require_internal_review" render={({ field }) => (
          <SwitchField label="Internal review required" checked={field.value} onCheckedChange={field.onChange} />
        )} />
        <Controller control={form.control} name="require_client_approval" render={({ field }) => (
          <SwitchField label="Client approval required" checked={field.value} onCheckedChange={field.onChange} />
        )} />
        <Controller control={form.control} name="reapproval_on_material_change" render={({ field }) => (
          <SwitchField label="Re-approval after material edits" checked={field.value} onCheckedChange={field.onChange} />
        )} />
      </div>
      <FormActions>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : client ? "Save changes" : "Create client"}
        </Button>
      </FormActions>
    </form>
  )
}
