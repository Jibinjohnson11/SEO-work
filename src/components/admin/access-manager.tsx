"use client"

import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { CheckboxGroup, Field, NativeSelect, SwitchField, type Option } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { useAction } from "@/hooks/use-action"
import { FEATURES, type AssignableRole, type FeatureDef } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { approveUser, updateRoleDefaults, updateUserAccess } from "@/server/admin/access"

export type RoleDefaults = Record<AssignableRole, string[]>

/** Checkbox list of a role's features. Keeps prerequisites consistent (e.g. "decide" needs "view"). */
export function FeaturePicker({
  role,
  value,
  onChange,
  disabled,
}: {
  role: AssignableRole
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}) {
  const id = useId()
  const defs: readonly FeatureDef[] = FEATURES[role]
  const selected = new Set(value)
  const toggle = (f: FeatureDef, on: boolean) => {
    const next = new Set(selected)
    if (on) {
      next.add(f.key)
      if (f.requires) next.add(f.requires)
    } else {
      next.delete(f.key)
      for (const d of defs) if (d.requires === f.key) next.delete(d.key)
    }
    onChange(defs.map((d) => d.key).filter((k) => next.has(k)))
  }
  return (
    <div className={cn("rounded-lg border", disabled && "opacity-60")}>
      <div className="max-h-72 divide-y overflow-y-auto">
        {defs.map((f) => (
          <label
            key={f.key}
            htmlFor={`${id}-${f.key}`}
            className={cn("flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-muted", f.requires && "pl-8", disabled && "cursor-not-allowed")}
          >
            <Checkbox id={`${id}-${f.key}`} className="mt-0.5" checked={selected.has(f.key)} disabled={disabled} onCheckedChange={(c) => toggle(f, Boolean(c))} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{f.label}</span>
              <span className="block text-xs text-muted-foreground">{f.description}</span>
            </span>
          </label>
        ))}
      </div>
      {disabled ? null : (
        <div className="flex items-center justify-between border-t px-3 py-1 text-xs text-muted-foreground">
          <span>
            {value.length} of {defs.length} enabled
          </span>
          <span className="flex gap-2">
            <button type="button" className="hover:text-foreground" onClick={() => onChange(defs.map((d) => d.key))}>
              All
            </button>
            <button type="button" className="hover:text-foreground" onClick={() => onChange([])}>
              None
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

function AccessFields({
  role,
  useDefaults,
  setUseDefaults,
  features,
  setFeatures,
  roleDefaults,
}: {
  role: AssignableRole
  useDefaults: boolean
  setUseDefaults: (v: boolean) => void
  features: string[]
  setFeatures: (v: string[]) => void
  roleDefaults: RoleDefaults
}) {
  return (
    <div className="space-y-2">
      <SwitchField
        label="Follow role defaults"
        description="Off: this user gets exactly the features selected below. On: they follow the role's default features, including later changes to them."
        checked={useDefaults}
        onCheckedChange={(on) => {
          setUseDefaults(on)
          if (!on) setFeatures(roleDefaults[role])
        }}
      />
      <FeaturePicker role={role} value={useDefaults ? roleDefaults[role] : features} onChange={setFeatures} disabled={useDefaults} />
    </div>
  )
}

export function ApproveUserButton({
  user,
  clients,
  campaigns,
  roleDefaults,
  variant = "default",
}: {
  user: { id: string; full_name: string; email: string }
  clients: Option[]
  campaigns: Option[]
  roleDefaults: RoleDefaults
  variant?: "default" | "outline"
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        Approve…
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Approve ${user.full_name || user.email}`}
        description="Choose a role and exactly which features this account may use. Nothing is enabled until you approve."
        wide
      >
        {open ? <ApproveForm user={user} clients={clients} campaigns={campaigns} roleDefaults={roleDefaults} onDone={() => setOpen(false)} /> : null}
      </FormDialog>
    </>
  )
}

function ApproveForm({
  user,
  clients,
  campaigns,
  roleDefaults,
  onDone,
}: {
  user: { id: string }
  clients: Option[]
  campaigns: Option[]
  roleDefaults: RoleDefaults
  onDone: () => void
}) {
  const { pending, execute } = useAction()
  const [role, setRole] = useState<AssignableRole>("intern")
  const [useDefaults, setUseDefaults] = useState(false)
  const [features, setFeatures] = useState<string[]>([])
  const [clientId, setClientId] = useState("")
  const [canApprove, setCanApprove] = useState(true)
  const [canDownload, setCanDownload] = useState(true)
  const [campaignIds, setCampaignIds] = useState<string[]>([])
  const effective = useDefaults ? roleDefaults[role] : features

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        const r = await execute(() =>
          approveUser(user.id, {
            role,
            use_role_defaults: useDefaults,
            features,
            client_id: clientId,
            can_approve: canApprove,
            can_download_reports: canDownload,
            campaign_ids: campaignIds,
          }),
        )
        if (r.ok) onDone()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role" required htmlFor="approve-role">
          <NativeSelect
            id="approve-role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as AssignableRole)
              setFeatures([])
            }}
          >
            <option value="intern">Intern</option>
            <option value="client">Client</option>
          </NativeSelect>
        </Field>
        {role === "client" ? (
          <Field label="Client workspace" required htmlFor="approve-client">
            <NativeSelect id="approve-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      {role === "client" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <SwitchField label="Workspace: can approve content" checked={canApprove} onCheckedChange={setCanApprove} />
          <SwitchField label="Workspace: can download reports" checked={canDownload} onCheckedChange={setCanDownload} />
        </div>
      ) : (
        <Field label="Assign to campaigns" hint="Optional — can be changed later from Interns.">
          <CheckboxGroup options={campaigns} value={campaignIds} onChange={setCampaignIds} searchable emptyText="No campaigns yet." />
        </Field>
      )}
      <Field label="Feature access" hint={effective.length === 0 ? "No features selected: the user can sign in but will see an empty dashboard." : undefined}>
        <AccessFields role={role} useDefaults={useDefaults} setUseDefaults={setUseDefaults} features={features} setFeatures={setFeatures} roleDefaults={roleDefaults} />
      </Field>
      <FormActions>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || (role === "client" && !clientId)}>
          {pending ? "Approving…" : "Approve account"}
        </Button>
      </FormActions>
    </form>
  )
}

export function ManageAccessButton({
  user,
  role,
  permissions,
  roleDefaults,
}: {
  user: { id: string; full_name: string; email: string }
  role: AssignableRole
  permissions: string[] | null
  roleDefaults: RoleDefaults
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Access
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Feature access — ${user.full_name || user.email}`}
        description="Changes apply on the user's next page load or action. Remove every feature to revoke access without disabling the account."
        wide
      >
        {open ? <AccessForm userId={user.id} role={role} permissions={permissions} roleDefaults={roleDefaults} onDone={() => setOpen(false)} /> : null}
      </FormDialog>
    </>
  )
}

function AccessForm({
  userId,
  role,
  permissions,
  roleDefaults,
  onDone,
}: {
  userId: string
  role: AssignableRole
  permissions: string[] | null
  roleDefaults: RoleDefaults
  onDone: () => void
}) {
  const { pending, execute } = useAction()
  const [useDefaults, setUseDefaults] = useState(permissions === null)
  const [features, setFeatures] = useState<string[]>(permissions ?? roleDefaults[role])
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        const r = await execute(() => updateUserAccess(userId, { use_role_defaults: useDefaults, features }))
        if (r.ok) onDone()
      }}
    >
      <AccessFields role={role} useDefaults={useDefaults} setUseDefaults={setUseDefaults} features={features} setFeatures={setFeatures} roleDefaults={roleDefaults} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save access"}
        </Button>
      </FormActions>
    </form>
  )
}

export function RoleDefaultsForm({ role, initial }: { role: AssignableRole; initial: string[] }) {
  const { pending, execute } = useAction()
  const [features, setFeatures] = useState(initial)
  const dirty = features.join() !== initial.join()
  return (
    <div className="space-y-3">
      <FeaturePicker role={role} value={features} onChange={setFeatures} />
      <div className="flex justify-end">
        <Button size="sm" disabled={pending || !dirty} onClick={() => execute(() => updateRoleDefaults(role, features))}>
          {pending ? "Saving…" : "Save defaults"}
        </Button>
      </div>
    </div>
  )
}
