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
import { CADENCE_UNIT, splitTarget } from "@/lib/task-plan"
import type { Task, TaskCadence, TaskStatus } from "@/lib/types"

export interface TaskOptions {
  brands: { id: string; label: string }[]
  campaigns: { id: string; label: string; client_id: string; type_ids: string[] }[]
  keywords: { id: string; keyword: string; campaigns: { id: string; primary: boolean }[] }[]
  /** Team members who can receive tasks (role and "My Tasks" permission checked on the server). */
  interns: { id: string; label: string }[]
  memberLabels: Record<string, string>
  types: { id: string; name: string }[]
  openTasks: { intern_id: string; campaign_id: string; keyword_id: string | null; backlink_type_id: string | null; cadence: TaskCadence }[]
  today: string
}

const CADENCES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "one_off", label: "One-time" },
]

export function AssignTasksButton({ options }: { options: TaskOptions }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Assign work</Button>
      <FormDialog open={open} onOpenChange={setOpen} title="Assign work" wide>
        {open ? <AssignForm options={options} onDone={() => setOpen(false)} /> : null}
      </FormDialog>
    </>
  )
}

function AssignForm({ options, onDone }: { options: TaskOptions; onDone: () => void }) {
  const { pending, execute } = useAction()
  const form = useForm<z.input<typeof taskSchema>, unknown, z.output<typeof taskSchema>>({
    resolver: zodResolver(taskSchema),
    defaultValues: { client_id: "", campaign_id: "", keyword_id: "", intern_ids: [], backlink_type_id: "", target_mode: "each", target_quantity: 5, cadence: "daily", due_date: "", instructions: "" },
  })
  const e = form.formState.errors
  const [clientId, campaignId, keywordId, typeId, cadence, interns, mode, qty] = useWatch({
    control: form.control,
    name: ["client_id", "campaign_id", "keyword_id", "backlink_type_id", "cadence", "intern_ids", "target_mode", "target_quantity"],
  })
  const campaigns = useMemo(() => options.campaigns.filter((c) => c.client_id === clientId), [clientId, options.campaigns])
  const keywords = useMemo(
    () =>
      options.keywords
        .flatMap((k) => k.campaigns.filter((c) => c.id === campaignId).map((c) => ({ id: k.id, keyword: k.keyword, primary: c.primary })))
        .sort((a, b) => Number(b.primary) - Number(a.primary)),
    [campaignId, options.keywords],
  )
  const campaign = options.campaigns.find((c) => c.id === campaignId)
  const types = campaign?.type_ids.length ? options.types.filter((t) => campaign.type_ids.includes(t.id)) : options.types
  // Members who already have this exact open task; the server rejects these as duplicates.
  const duplicates = new Set(
    options.openTasks
      .filter((t) => t.campaign_id === campaignId && t.keyword_id === keywordId && (t.backlink_type_id ?? "") === typeId && t.cadence === cadence)
      .map((t) => t.intern_id),
  )
  const clashing = interns.filter((i) => duplicates.has(i))
  const quantity = Math.max(0, Math.floor(Number(qty) || 0))
  const shared = mode === "shared" && interns.length > 1
  const split = splitTarget(quantity, interns.length, shared ? "shared" : "each")
  const unit = CADENCE_UNIT[cadence]
  const summary =
    interns.length === 0 || quantity === 0
      ? "Choose team members and a target"
      : shared
        ? `${interns.length} tasks · ${quantity}/${unit} shared (${split.join(" + ")})`
        : `${interns.length} task${interns.length === 1 ? "" : "s"} · ${quantity}/${unit} each${interns.length > 1 ? ` · ${quantity * interns.length}/${unit} in total` : ""}`

  const pickCampaign = (id: string) => {
    form.setValue("campaign_id", id, { shouldValidate: form.formState.isSubmitted })
    const primary = options.keywords.find((k) => k.campaigns.some((c) => c.id === id && c.primary))
    form.setValue("keyword_id", primary?.id ?? "")
    const allowed = options.campaigns.find((c) => c.id === id)?.type_ids ?? []
    if (allowed.length && !allowed.includes(form.getValues("backlink_type_id"))) form.setValue("backlink_type_id", "")
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (v) => {
        const r = await execute(() => createTasks(v), { success: `${v.intern_ids.length} task${v.intern_ids.length === 1 ? "" : "s"} assigned` })
        if (r.ok) onDone()
      })}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Brand" required htmlFor="client_id" error={e.client_id?.message}>
          <NativeSelect id="client_id" {...form.register("client_id", { onChange: () => pickCampaign("") })}>
            <option value="">Select brand…</option>
            {options.brands.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Campaign" required htmlFor="campaign_id" error={e.campaign_id?.message}>
          <NativeSelect id="campaign_id" value={campaignId} onChange={(ev) => pickCampaign(ev.target.value)} disabled={!clientId}>
            <option value="">{clientId && campaigns.length === 0 ? "No active campaigns" : "Select campaign…"}</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Keyword" required htmlFor="keyword_id" error={e.keyword_id?.message}>
          <NativeSelect id="keyword_id" {...form.register("keyword_id")} disabled={!campaignId}>
            <option value="">{campaignId && keywords.length === 0 ? "No keywords on this campaign" : "Select keyword…"}</option>
            {keywords.map((k) => <option key={k.id} value={k.id}>{k.keyword}{k.primary ? " (primary)" : ""}</option>)}
          </NativeSelect>
        </Field>
      </div>

      <Field label="Assign to" required error={e.intern_ids?.message}>
        <Controller
          control={form.control}
          name="intern_ids"
          render={({ field }) => (
            <CheckboxGroup
              options={options.interns.map((i) => ({ value: i.id, label: i.label, hint: duplicates.has(i.id) ? "Already assigned" : undefined }))}
              value={field.value}
              onChange={field.onChange}
              emptyText="No team members can receive tasks yet."
              searchable
            />
          )}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Backlink type" htmlFor="backlink_type_id">
          <NativeSelect id="backlink_type_id" {...form.register("backlink_type_id")}>
            <option value="">Any allowed type</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Quantity target" required htmlFor="target_quantity" error={e.target_quantity?.message}>
          <Input id="target_quantity" type="number" min={1} max={1000} inputMode="numeric" {...form.register("target_quantity")} />
        </Field>
        <Field label="Work frequency" required htmlFor="cadence">
          <NativeSelect id="cadence" {...form.register("cadence")}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="one_off">One-time</option>
          </NativeSelect>
        </Field>
        <Field label="Deadline" htmlFor="due_date" error={e.due_date?.message}>
          <Input id="due_date" type="date" min={options.today} {...form.register("due_date")} />
        </Field>
      </div>

      {interns.length > 1 ? (
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <legend className="sr-only">Target split</legend>
          <span className="text-xs font-medium text-muted-foreground">Target is</span>
          {([["each", "Per member"], ["shared", "Shared by the group"]] as const).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" value={value} className="accent-primary" {...form.register("target_mode")} />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}

      <Field label="Instructions" htmlFor="instructions">
        <Textarea id="instructions" rows={2} placeholder="Optional guidelines (quality bar, target sites, anchors…)" {...form.register("instructions")} />
      </Field>

      {clashing.length ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Already has this open task: {clashing.map((i) => options.memberLabels[i] ?? "Team member").join(", ")}. Deselect them or change the keyword, type or frequency.
        </p>
      ) : null}

      <FormActions>
        <span className="mr-auto self-center text-xs text-muted-foreground">{summary}</span>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending || interns.length === 0 || clashing.length > 0}>{pending ? "Assigning…" : "Assign"}</Button>
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
  const keywords = options.keywords.filter((k) => k.campaigns.some((c) => c.id === task.campaign_id))
  // Keep the current assignee selectable even if they can no longer receive new tasks.
  const members = options.interns.some((i) => i.id === task.intern_id) ? options.interns : [{ id: task.intern_id, label: options.memberLabels[task.intern_id] ?? "Current assignee" }, ...options.interns]
  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => { const r = await execute(() => updateTask(task.id, v)); if (r.ok) onDone() })}>
      <Field label="Title" required error={e.title?.message} htmlFor="t-title"><Input id="t-title" {...form.register("title")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Team member" htmlFor="t-intern"><NativeSelect id="t-intern" {...form.register("intern_id")}>{members.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</NativeSelect></Field>
        <Field label="Status" htmlFor="t-status"><NativeSelect id="t-status" {...form.register("status")}>{(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}</NativeSelect></Field>
        <Field label="Backlink type" htmlFor="t-type"><NativeSelect id="t-type" {...form.register("backlink_type_id")}><option value="">Any</option>{options.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
        <Field label="Keyword" htmlFor="t-kw"><NativeSelect id="t-kw" {...form.register("keyword_id")}><option value="">Any</option>{keywords.map((k) => <option key={k.id} value={k.id}>{k.keyword}</option>)}</NativeSelect></Field>
        <Field label="Work frequency" htmlFor="t-cad"><NativeSelect id="t-cad" {...form.register("cadence")}>{CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</NativeSelect></Field>
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
