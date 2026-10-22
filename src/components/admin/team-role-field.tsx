"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Field, NativeSelect } from "@/components/shared/form"
import { TEAM_ROLES } from "@/lib/team"

const OTHER = "__other"

/** Team role picker (preset or custom). Stored as the profile's job title; it does not change access. */
export function TeamRoleField({ id = "job_title", value, onChange, error }: { id?: string; value: string; onChange: (v: string) => void; error?: string }) {
  const preset = (TEAM_ROLES as readonly string[]).includes(value)
  const [custom, setCustom] = useState(!preset && value !== "")
  return (
    <Field label="Team role" htmlFor={id} error={error} hint="Shown on the Team page. Access is set in Users & Access.">
      <div className="flex flex-col gap-2 sm:flex-row">
        <NativeSelect
          id={id}
          value={custom ? OTHER : value}
          onChange={(e) => {
            const v = e.target.value
            setCustom(v === OTHER)
            onChange(v === OTHER ? "" : v)
          }}
        >
          <option value="">Not set</option>
          {TEAM_ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
          <option value={OTHER}>Other…</option>
        </NativeSelect>
        {custom ? <Input aria-label="Custom team role" placeholder="e.g. Content writer" maxLength={120} value={value} onChange={(e) => onChange(e.target.value)} autoFocus /> : null}
      </div>
    </Field>
  )
}
