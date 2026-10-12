"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CheckboxGroup, Field, ListEditor, SwitchField } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { ActiveBadge } from "@/components/shared/status-badge"
import { useAction } from "@/hooks/use-action"
import { CONFIGURABLE_REQUIRED_FIELDS, humanize } from "@/lib/workflow"
import { moveBacklinkType, saveBacklinkType, setBacklinkTypeActive } from "@/server/admin/backlink-types"
import type { BacklinkType } from "@/lib/types"

type TypeRow = BacklinkType & { campaign_ids: string[] }

export function BacklinkTypesManager({ types, campaigns }: { types: TypeRow[]; campaigns: { value: string; label: string }[] }) {
  const [editing, setEditing] = useState<TypeRow | "new" | null>(null)
  const { pending, execute } = useAction()
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Categories for legitimate, editorial placements — not automated link building. Deactivated types stay on existing submissions but can&apos;t be chosen for new ones.</p>
      <ul className="divide-y rounded-lg border">
        {types.map((t, i) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="flex flex-col">
              <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0 || pending} onClick={() => execute(() => moveBacklinkType(t.id, "up"))} aria-label={`Move ${t.name} up`}><ArrowUp className="size-3.5" /></button>
              <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === types.length - 1 || pending} onClick={() => execute(() => moveBacklinkType(t.id, "down"))} aria-label={`Move ${t.name} down`}><ArrowDown className="size-3.5" /></button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.name} <ActiveBadge active={t.is_active} /></div>
              <div className="truncate text-xs text-muted-foreground">
                {t.description} · Required: {t.required_fields.length ? t.required_fields.map(humanize).join(", ") : "core fields only"} · {t.campaign_ids.length ? `${t.campaign_ids.length} campaigns restrict to listed types` : "available to all campaigns"}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => execute(() => setBacklinkTypeActive(t.id, !t.is_active))}>{t.is_active ? "Deactivate" : "Activate"}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button>
          </li>
        ))}
      </ul>
      <Button size="sm" onClick={() => setEditing("new")}><Plus /> New backlink type</Button>
      <FormDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? "New backlink type" : `Edit ${editing?.name ?? ""}`} wide>
        {editing !== null ? <TypeForm type={editing === "new" ? undefined : editing} campaigns={campaigns} onDone={() => setEditing(null)} nextOrder={(types.at(-1)?.sort_order ?? 0) + 10} /> : null}
      </FormDialog>
    </div>
  )
}

function TypeForm({ type, campaigns, onDone, nextOrder }: { type?: TypeRow; campaigns: { value: string; label: string }[]; onDone: () => void; nextOrder: number }) {
  const [v, setV] = useState({
    name: type?.name ?? "",
    description: type?.description ?? "",
    required_fields: type?.required_fields ?? [],
    review_checklist: type?.review_checklist ?? [],
    sort_order: type?.sort_order ?? nextOrder,
    is_active: type?.is_active ?? true,
    campaign_ids: type?.campaign_ids ?? [],
  })
  const { pending, execute } = useAction()
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required htmlFor="bt-name"><Input id="bt-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <SwitchField label="Active" checked={v.is_active} onCheckedChange={(c) => setV({ ...v, is_active: c })} />
      </div>
      <Field label="Description" htmlFor="bt-desc"><Textarea id="bt-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Required submission fields" hint="Website and target URL are always required">
          <CheckboxGroup options={CONFIGURABLE_REQUIRED_FIELDS.map((f) => ({ value: f, label: humanize(f) }))} value={v.required_fields} onChange={(x) => setV({ ...v, required_fields: x })} />
        </Field>
        <Field label="Allowed for campaigns" hint="Adds this type to each campaign's allowed list. Note: a campaign with no list allows every active type; giving it a list restricts it to the listed types.">
          <CheckboxGroup options={campaigns} value={v.campaign_ids} onChange={(x) => setV({ ...v, campaign_ids: x })} searchable />
        </Field>
      </div>
      <Field label="Default review checklist"><ListEditor value={v.review_checklist} onChange={(x) => setV({ ...v, review_checklist: x })} placeholder="Add a checklist item" /></Field>
      <FormActions>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button disabled={pending || !v.name.trim()} onClick={async () => { const r = await execute(() => saveBacklinkType(type?.id ?? null, v)); if (r.ok) onDone() }}>{pending ? "Saving…" : "Save"}</Button>
      </FormActions>
    </div>
  )
}
