"use client"

import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CheckboxGroup, Field, NativeSelect, type Option } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { useAction } from "@/hooks/use-action"
import { internUpdateSchema } from "@/lib/validation"
import { resendInvite, sendPasswordReset, setUserStatus, updateIntern } from "@/server/admin/users"
import type { Profile } from "@/lib/types"

export function UserMenu({ user, intern }: { user: Pick<Profile, "id" | "status" | "full_name" | "email">; intern?: { profile: Profile; campaignIds: string[]; campaigns: Option[] } }) {
  const { execute } = useAction()
  const [edit, setEdit] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="User actions" />}><MoreHorizontal /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {intern ? <DropdownMenuItem onClick={() => setEdit(true)}>Edit profile & assignments</DropdownMenuItem> : null}
          {user.status === "invited" ? <DropdownMenuItem onClick={() => execute(() => resendInvite(user.id))}>Resend invitation</DropdownMenuItem> : null}
          {user.status === "active" ? <DropdownMenuItem onClick={() => execute(() => sendPasswordReset(user.id))}>Send password reset</DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          {user.status === "disabled" ? (
            <DropdownMenuItem onClick={() => execute(() => setUserStatus(user.id, "active"))}>Re-enable access</DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onClick={() => execute(() => setUserStatus(user.id, "disabled"))}>Disable access</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {intern ? (
        <FormDialog open={edit} onOpenChange={setEdit} title={`Edit ${user.full_name || user.email}`}>
          {edit ? <InternEditForm profile={intern.profile} campaignIds={intern.campaignIds} campaigns={intern.campaigns} onDone={() => setEdit(false)} /> : null}
        </FormDialog>
      ) : null}
    </>
  )
}

export function InternEditButton(props: { profile: Profile; campaignIds: string[]; campaigns: Option[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Edit</Button>
      <FormDialog open={open} onOpenChange={setOpen} title="Edit intern">
        {open ? <InternEditForm {...props} onDone={() => setOpen(false)} /> : null}
      </FormDialog>
    </>
  )
}

function InternEditForm({ profile, campaignIds, campaigns, onDone }: { profile: Profile; campaignIds: string[]; campaigns: Option[]; onDone: () => void }) {
  const { pending, execute } = useAction()
  const form = useForm<z.input<typeof internUpdateSchema>, unknown, z.output<typeof internUpdateSchema>>({
    resolver: zodResolver(internUpdateSchema),
    defaultValues: {
      full_name: profile.full_name,
      job_title: profile.job_title ?? "",
      joining_date: profile.joining_date ?? "",
      daily_target: profile.daily_target,
      weekly_target: profile.weekly_target,
      monthly_target: profile.monthly_target,
      status: profile.status,
      campaign_ids: campaignIds,
    },
  })
  const e = form.formState.errors
  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => { const r = await execute(() => updateIntern(profile.id, v)); if (r.ok) onDone() })}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={e.full_name?.message} htmlFor="full_name"><Input id="full_name" {...form.register("full_name")} /></Field>
        <Field label="Role / title" htmlFor="job_title"><Input id="job_title" {...form.register("job_title")} /></Field>
        <Field label="Joining date" htmlFor="joining_date"><Input id="joining_date" type="date" {...form.register("joining_date")} /></Field>
        <Field label="Status" htmlFor="status">
          <NativeSelect id="status" {...form.register("status")}><option value="active">Active</option><option value="invited">Invited</option><option value="disabled">Disabled</option></NativeSelect>
        </Field>
        <Field label="Daily target" htmlFor="daily_target" error={e.daily_target?.message}><Input id="daily_target" type="number" min={0} {...form.register("daily_target")} /></Field>
        <Field label="Weekly target" htmlFor="weekly_target" error={e.weekly_target?.message}><Input id="weekly_target" type="number" min={0} {...form.register("weekly_target")} /></Field>
        <Field label="Monthly target" htmlFor="monthly_target" error={e.monthly_target?.message}><Input id="monthly_target" type="number" min={0} {...form.register("monthly_target")} /></Field>
      </div>
      <Field label="Assigned campaigns">
        <Controller control={form.control} name="campaign_ids" render={({ field }) => <CheckboxGroup options={campaigns} value={field.value} onChange={field.onChange} searchable />} />
      </Field>
      <FormActions>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </FormActions>
    </form>
  )
}
