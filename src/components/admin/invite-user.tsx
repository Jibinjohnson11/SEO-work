"use client"

import { useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { TeamRoleField } from "@/components/admin/team-role-field"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CheckboxGroup, Field, NativeSelect, SwitchField, type Option } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { useAction } from "@/hooks/use-action"
import { inviteUserSchema } from "@/lib/validation"
import { inviteUser } from "@/server/admin/users"

type Values = z.input<typeof inviteUserSchema>

export function InviteUserButton({
  role,
  clients = [],
  campaigns = [],
  fixedClientId,
  defaults = { daily_target: 5, weekly_target: 25, monthly_target: 100 },
  children,
  variant = "default",
}: {
  role?: "intern" | "client"
  clients?: Option[]
  campaigns?: Option[]
  fixedClientId?: string
  defaults?: { daily_target: number; weekly_target: number; monthly_target: number }
  children: React.ReactNode
  variant?: "default" | "outline"
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={role === "client" ? "Invite client user" : role === "intern" ? "Add Team Member" : "Invite user"}
        description="They receive an email link to set a password. Super Admin access cannot be granted here."
      >
        {open ? (
          <InviteForm role={role} clients={clients} campaigns={campaigns} fixedClientId={fixedClientId} defaults={defaults} onDone={() => setOpen(false)} />
        ) : null}
      </FormDialog>
    </>
  )
}

function InviteForm({
  role,
  clients,
  campaigns,
  fixedClientId,
  defaults,
  onDone,
}: {
  role?: "intern" | "client"
  clients: Option[]
  campaigns: Option[]
  fixedClientId?: string
  defaults: { daily_target: number; weekly_target: number; monthly_target: number }
  onDone: () => void
}) {
  const { pending, execute } = useAction()
  const form = useForm<Values, unknown, z.output<typeof inviteUserSchema>>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: {
      email: "",
      full_name: "",
      role: role ?? "intern",
      job_title: "",
      joining_date: "",
      ...defaults,
      client_id: fixedClientId ?? "",
      campaign_ids: [],
      can_approve: true,
      can_download_reports: true,
    },
  })
  const selectedRole = useWatch({ control: form.control, name: "role" })
  const e = form.formState.errors
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (v) => {
        const r = await execute(() => inviteUser(v))
        if (r.ok) onDone()
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={e.full_name?.message} htmlFor="full_name">
          <Input id="full_name" {...form.register("full_name")} />
        </Field>
        <Field label="Email" required error={e.email?.message} htmlFor="email">
          <Input id="email" type="email" {...form.register("email")} />
        </Field>
        {role ? null : (
          <Field label="Role" htmlFor="role">
            <NativeSelect id="role" {...form.register("role")}>
              <option value="intern">Team member</option>
              <option value="client">Client</option>
            </NativeSelect>
          </Field>
        )}
        {selectedRole === "intern" ? (
          <Controller control={form.control} name="job_title" render={({ field }) => <TeamRoleField value={field.value ?? ""} onChange={field.onChange} error={e.job_title?.message} />} />
        ) : (
          <Field label="Job title" htmlFor="job_title">
            <Input id="job_title" {...form.register("job_title")} />
          </Field>
        )}
      </div>
      {selectedRole === "intern" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Joining date" htmlFor="joining_date">
              <Input id="joining_date" type="date" {...form.register("joining_date")} />
            </Field>
            <Field label="Daily target" htmlFor="daily_target" error={e.daily_target?.message}>
              <Input id="daily_target" type="number" min={0} {...form.register("daily_target")} />
            </Field>
            <Field label="Weekly target" htmlFor="weekly_target" error={e.weekly_target?.message}>
              <Input id="weekly_target" type="number" min={0} {...form.register("weekly_target")} />
            </Field>
            <Field label="Monthly target" htmlFor="monthly_target" error={e.monthly_target?.message}>
              <Input id="monthly_target" type="number" min={0} {...form.register("monthly_target")} />
            </Field>
          </div>
          <Field label="Assign to campaigns">
            <Controller control={form.control} name="campaign_ids" render={({ field }) => (
              <CheckboxGroup options={campaigns} value={field.value} onChange={field.onChange} searchable emptyText="No campaigns yet." />
            )} />
          </Field>
        </>
      ) : (
        <>
          {fixedClientId ? null : (
            <Field label="Brand workspace" required htmlFor="client_id" error={e.client_id?.message}>
              <NativeSelect id="client_id" {...form.register("client_id")}>
                <option value="">Choose a brand…</option>
                {clients.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Controller control={form.control} name="can_approve" render={({ field }) => (
              <SwitchField label="Can approve content" checked={field.value} onCheckedChange={field.onChange} />
            )} />
            <Controller control={form.control} name="can_download_reports" render={({ field }) => (
              <SwitchField label="Can download reports" checked={field.value} onCheckedChange={field.onChange} />
            )} />
          </div>
        </>
      )}
      <FormActions>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </FormActions>
    </form>
  )
}
