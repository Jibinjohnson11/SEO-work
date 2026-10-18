"use client"

import { useMemo, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CheckboxGroup, Field, NativeSelect } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import type { BulkProps } from "@/components/shared/data-table"
import { useAction } from "@/hooks/use-action"
import { keywordSchema } from "@/lib/validation"
import { bulkKeywordAction, deleteKeyword, saveKeyword } from "@/server/admin/keywords"
import type { Keyword } from "@/lib/types"

type Values = z.input<typeof keywordSchema>
export interface KeywordOptions {
  clients: { id: string; label: string }[]
  campaigns: { id: string; label: string; client_id: string }[]
  groups: string[]
}

export function KeywordFormButton({ keyword, campaignIds, options, children, variant = "default", size = "sm" }: { keyword?: Keyword; campaignIds?: string[]; options: KeywordOptions; children: React.ReactNode; variant?: "default" | "outline" | "ghost"; size?: "sm" | "xs" }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>{children}</Button>
      <FormDialog open={open} onOpenChange={setOpen} title={keyword ? "Edit keyword" : "Add keyword"}>
        {open ? <KeywordForm keyword={keyword} campaignIds={campaignIds} options={options} onDone={() => setOpen(false)} /> : null}
      </FormDialog>
    </>
  )
}

function KeywordForm({ keyword, campaignIds, options, onDone }: { keyword?: Keyword; campaignIds?: string[]; options: KeywordOptions; onDone: () => void }) {
  const { pending, execute } = useAction()
  const form = useForm<Values, unknown, z.output<typeof keywordSchema>>({
    resolver: zodResolver(keywordSchema),
    defaultValues: {
      keyword: keyword?.keyword ?? "",
      client_id: keyword?.client_id ?? "",
      search_intent: keyword?.search_intent ?? "",
      target_url: keyword?.target_url ?? "",
      priority: keyword?.priority ?? "medium",
      group_name: keyword?.group_name ?? "",
      notes: keyword?.notes ?? "",
      status: keyword?.status ?? "active",
      campaign_ids: campaignIds ?? [],
    },
  })
  const e = form.formState.errors
  const clientId = useWatch({ control: form.control, name: "client_id" })
  const campaigns = useMemo(() => options.campaigns.filter((c) => c.client_id === clientId), [options.campaigns, clientId])
  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => { const r = await execute(() => saveKeyword(keyword?.id ?? null, v)); if (r.ok) onDone() })}>
      <Field label="Keyword" required error={e.keyword?.message} htmlFor="keyword"><Input id="keyword" {...form.register("keyword")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client" required error={e.client_id?.message} htmlFor="client_id">
          <NativeSelect id="client_id" {...form.register("client_id", { onChange: () => form.setValue("campaign_ids", []) })} disabled={Boolean(keyword)}>
            <option value="">Choose…</option>
            {options.clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Search intent" htmlFor="search_intent">
          <NativeSelect id="search_intent" {...form.register("search_intent")}>
            <option value="">—</option>
            {["informational", "navigational", "commercial", "transactional", "local"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Target URL" error={e.target_url?.message} htmlFor="target_url" className="sm:col-span-2"><Input id="target_url" placeholder="https://" {...form.register("target_url")} /></Field>
        <Field label="Priority" htmlFor="priority">
          <NativeSelect id="priority" {...form.register("priority")}>{["low", "medium", "high", "urgent"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</NativeSelect>
        </Field>
        <Field label="Group" htmlFor="group_name" hint="e.g. Implants, Orthodontics">
          <Input id="group_name" list="keyword-groups" {...form.register("group_name")} />
          <datalist id="keyword-groups">{options.groups.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="Status" htmlFor="status">
          <NativeSelect id="status" {...form.register("status")}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></NativeSelect>
        </Field>
      </div>
      <Field label="Campaigns">
        <Controller control={form.control} name="campaign_ids" render={({ field }) => (
          <CheckboxGroup options={campaigns.map((c) => ({ value: c.id, label: c.label }))} value={field.value} onChange={field.onChange} searchable emptyText={clientId ? "This client has no campaigns yet." : "Choose a client first."} />
        )} />
      </Field>
      <Field label="Notes" htmlFor="notes"><Textarea id="notes" rows={2} {...form.register("notes")} /></Field>
      <FormActions>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save keyword"}</Button>
      </FormActions>
    </form>
  )
}

export function KeywordBulkActions({ selectedIds = [], clear, campaigns }: BulkProps & { campaigns: { id: string; label: string }[] }) {
  const { pending, execute } = useAction()
  const [group, setGroup] = useState("")
  const [campaign, setCampaign] = useState("")
  const done = { onSuccess: () => clear?.() }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect value={campaign} onChange={(e) => setCampaign(e.target.value)} className="w-56" aria-label="Campaign">
        <option value="">Assign to campaign…</option>
        {campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </NativeSelect>
      <Button size="sm" variant="outline" disabled={!campaign || pending} onClick={() => execute(() => bulkKeywordAction(selectedIds, { type: "assign", campaignId: campaign }), done)}>Assign</Button>
      <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Group name" className="h-8 w-36" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => execute(() => bulkKeywordAction(selectedIds, { type: "group", group }), done)}>Set group</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => execute(() => bulkKeywordAction(selectedIds, { type: "status", status: "paused" }), done)}>Pause</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => execute(() => bulkKeywordAction(selectedIds, { type: "status", status: "active" }), done)}>Activate</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => execute(() => bulkKeywordAction(selectedIds, { type: "status", status: "archived" }), done)}>Archive</Button>
    </div>
  )
}

export function KeywordRowMenu({ keyword, campaignIds, options }: { keyword: Keyword; campaignIds: string[]; options: KeywordOptions }) {
  const { execute } = useAction()
  const [edit, setEdit] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Keyword actions" />}><MoreHorizontal /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEdit(true)}>Edit / reassign</DropdownMenuItem>
          <DropdownMenuItem onClick={() => execute(() => deleteKeyword(keyword.id), { success: "Keyword removed (archived if it has submissions)" })}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog open={edit} onOpenChange={setEdit} title="Edit keyword">
        {edit ? <KeywordForm keyword={keyword} campaignIds={campaignIds} options={options} onDone={() => setEdit(false)} /> : null}
      </FormDialog>
    </>
  )
}
