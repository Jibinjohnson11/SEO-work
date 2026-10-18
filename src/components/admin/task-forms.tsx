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
import { taskSchema, taskUpdateSchema } from "@/lib/validation"
import { bulkTaskAction, createTasks, deleteTask, updateTask } from "@/server/admin/tasks"
import { TASK_STATUS } from "@/lib/workflow"
import type { Task, TaskStatus } from "@/lib/types"

export interface TaskOptions {
  interns: { id: string; label: string }[]
  campaigns: { id: string; label: string; client_id: string }[]
  keywords: { id: string; keyword: string; campaign_ids: string[] }[]
  types: { id: string; name: string }[]
  today: string
}

const CADENCES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "one_off", label: "One-off" },
]

export function AssignTasksButton({ options }: { options: TaskOptions }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Assign work</Button>
      <FormDialog open={open} onOpenChange={setOpen} title="Assign work" description="Creates one task for every selected intern × campaign combination." wide>
        {open ? <AssignForm options={options} onDone={() => setOpen(false)} /> : null}
      </FormDialog>
    </>
  )
}

function AssignForm({ options, onDone }: { options: TaskOptions; onDone: () => void }) {
  const { pending, execute } = useAction()
  const form = useForm<z.input<typeof taskSchema>, unknown, z.output<typeof taskSchema>>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: "", intern_ids: [], campaign_ids: [], keyword_id: "", backlink_type_id: "", cadence: "daily", target_quantity: 5, start_date: options.today, due_date: "", priority: "medium", instructions: "" },
  })
  const e = form.formState.errors
  const campaignIds = useWatch({ control: form.control, name: "campaign_ids" })
  const interns = useWatch({ control: form.control, name: "intern_ids" })
  const keywords = useMemo(() => (campaignIds.length === 1 ? options.keywords.filter((k) => k.campaign_ids.includes(campaignIds[0])) : []), [campaignIds, options.keywords])
  const total = interns.length * campaignIds.length
  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => { const r = await execute(() => createTasks(v), { success: `${total} task${total === 1 ? "" : "s"} assigned` }); if (r.ok) onDone() })}>
      <Field label="Task title" required error={e.title?.message} htmlFor="title"><Input id="title" placeholder="e.g. Business directory submissions" {...form.register("title")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Interns" required error={e.intern_ids?.message}>
          <Controller control={form.control} name="intern_ids" render={({ field }) => <CheckboxGroup options={options.interns.map((i) => ({ value: i.id, label: i.label }))} value={field.value} onChange={field.onChange} searchable />} />
        </Field>
        <Field label="Campaigns" required error={e.campaign_ids?.message}>
          <Controller control={form.control} name="campaign_ids" render={({ field }) => <CheckboxGroup options={options.campaigns.map((c) => ({ value: c.id, label: c.label }))} value={field.value} onChange={(v) => { field.onChange(v); form.setValue("keyword_id", "") }} searchable />} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Backlink type" htmlFor="backlink_type_id">
          <NativeSelect id="backlink_type_id" {...form.register("backlink_type_id")}><option value="">Any allowed type</option>{options.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
        </Field>
        <Field label="Keyword" htmlFor="keyword_id" error={e.keyword_id?.message} hint={campaignIds.length === 1 ? undefined : "Pick one campaign to target a keyword"}>
          <NativeSelect id="keyword_id" {...form.register("keyword_id")} disabled={campaignIds.length !== 1}><option value="">Any campaign keyword</option>{keywords.map((k) => <option key={k.id} value={k.id}>{k.keyword}</option>)}</NativeSelect>
        </Field>
        <Field label="Priority" htmlFor="priority">
          <NativeSelect id="priority" {...form.register("priority")}>{["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</NativeSelect>
        </Field>
        <Field label="Cadence" htmlFor="cadence"><NativeSelect id="cadence" {...form.register("cadence")}>{CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</NativeSelect></Field>
        <Field label="Quantity target" htmlFor="target_quantity" error={e.target_quantity?.message} hint="Per cadence period"><Input id="target_quantity" type="number" min={1} {...form.register("target_quantity")} /></Field>
        <div />
        <Field label="Start date" htmlFor="start_date" error={e.start_date?.message}><Input id="start_date" type="date" {...form.register("start_date")} /></Field>
        <Field label="Due date / deadline" htmlFor="due_date" error={e.due_date?.message}><Input id="due_date" type="date" {...form.register("due_date")} /></Field>
      </div>
      <Field label="Instructions" htmlFor="instructions"><Textarea id="instructions" rows={3} placeholder="Quality bar, target sites, anchor guidance…" {...form.register("instructions")} /></Field>
      <FormActions>
        <span className="mr-auto self-center text-xs text-muted-foreground">{total} task{total === 1 ? "" : "s"} will be created</span>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending || total === 0}>{pending ? "Assigning…" : "Assign"}</Button>
      </FormActions>
    </form>
  )
}

export function TaskRowMenu({ task, options }: { task: Task; options: TaskOptions }) {
  const [open, setOpen] = useState(false)
  const { execute } = useAction()
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Task actions" />}><MoreHorizontal /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setOpen(true)}>Edit / reassign</DropdownMenuItem>
          <DropdownMenuItem onClick={() => execute(() => bulkTaskAction([task.id], { type: "status", status: "completed" }))}>Mark completed</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => execute(() => deleteTask(task.id), { success: "Task removed (cancelled if work was linked)" })}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog open={open} onOpenChange={setOpen} title={`Edit ${task.code}`}>
        {open ? <EditTaskForm task={task} options={options} onDone={() => setOpen(false)} /> : null}
      </FormDialog>
    </>
  )
}

function EditTaskForm({ task, options, onDone }: { task: Task; options: TaskOptions; onDone: () => void }) {
  const { pending, execute } = useAction()
  const form = useForm<z.input<typeof taskUpdateSchema>, unknown, z.output<typeof taskUpdateSchema>>({
    resolver: zodResolver(taskUpdateSchema),
    defaultValues: { title: task.title, intern_id: task.intern_id, keyword_id: task.keyword_id ?? "", backlink_type_id: task.backlink_type_id ?? "", cadence: task.cadence, target_quantity: task.target_quantity, start_date: task.start_date, due_date: task.due_date ?? "", priority: task.priority, status: task.status, instructions: task.instructions ?? "" },
  })
  const e = form.formState.errors
  const keywords = options.keywords.filter((k) => k.campaign_ids.includes(task.campaign_id))
  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => { const r = await execute(() => updateTask(task.id, v)); if (r.ok) onDone() })}>
      <Field label="Title" required error={e.title?.message} htmlFor="t-title"><Input id="t-title" {...form.register("title")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Intern" htmlFor="t-intern"><NativeSelect id="t-intern" {...form.register("intern_id")}>{options.interns.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</NativeSelect></Field>
        <Field label="Status" htmlFor="t-status"><NativeSelect id="t-status" {...form.register("status")}>{(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}</NativeSelect></Field>
        <Field label="Backlink type" htmlFor="t-type"><NativeSelect id="t-type" {...form.register("backlink_type_id")}><option value="">Any</option>{options.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
        <Field label="Keyword" htmlFor="t-kw"><NativeSelect id="t-kw" {...form.register("keyword_id")}><option value="">Any</option>{keywords.map((k) => <option key={k.id} value={k.id}>{k.keyword}</option>)}</NativeSelect></Field>
        <Field label="Cadence" htmlFor="t-cad"><NativeSelect id="t-cad" {...form.register("cadence")}>{CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</NativeSelect></Field>
        <Field label="Quantity target" htmlFor="t-qty" error={e.target_quantity?.message}><Input id="t-qty" type="number" min={1} {...form.register("target_quantity")} /></Field>
        <Field label="Start date" htmlFor="t-start"><Input id="t-start" type="date" {...form.register("start_date")} /></Field>
        <Field label="Due date" htmlFor="t-due" error={e.due_date?.message}><Input id="t-due" type="date" {...form.register("due_date")} /></Field>
        <Field label="Priority" htmlFor="t-pri"><NativeSelect id="t-pri" {...form.register("priority")}>{["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</NativeSelect></Field>
      </div>
      <Field label="Instructions" htmlFor="t-ins"><Textarea id="t-ins" rows={3} {...form.register("instructions")} /></Field>
      <FormActions>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save task"}</Button>
      </FormActions>
    </form>
  )
}

export function TaskBulkActions({ selectedIds = [], clear, interns }: BulkProps & { interns: { id: string; label: string }[] }) {
  const { pending, execute } = useAction()
  const [status, setStatus] = useState("")
  const [intern, setIntern] = useState("")
  const [due, setDue] = useState("")
  const done = { onSuccess: () => clear?.() }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect className="w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        <option value="">Set status…</option>
        {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}
      </NativeSelect>
      <Button size="sm" variant="outline" disabled={!status || pending} onClick={() => execute(() => bulkTaskAction(selectedIds, { type: "status", status: status as TaskStatus }), done)}>Apply</Button>
      <NativeSelect className="w-40" value={intern} onChange={(e) => setIntern(e.target.value)} aria-label="Reassign to">
        <option value="">Reassign to…</option>
        {interns.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
      </NativeSelect>
      <Button size="sm" variant="outline" disabled={!intern || pending} onClick={() => execute(() => bulkTaskAction(selectedIds, { type: "reassign", internId: intern }), done)}>Reassign</Button>
      <Input type="date" className="h-8 w-auto" value={due} onChange={(e) => setDue(e.target.value)} aria-label="New due date" />
      <Button size="sm" variant="outline" disabled={!due || pending} onClick={() => execute(() => bulkTaskAction(selectedIds, { type: "due", dueDate: due }), done)}>Set due date</Button>
    </div>
  )
}
