"use client"

import { useId, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: React.ReactNode
  htmlFor?: string
  error?: string
  hint?: React.ReactNode
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export interface Option {
  value: string
  label: string
  hint?: string
}

export function CheckboxGroup({
  options,
  value,
  onChange,
  searchable,
  emptyText = "Nothing to choose from yet.",
  className,
}: {
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  searchable?: boolean
  emptyText?: string
  className?: string
}) {
  const id = useId()
  const [q, setQ] = useState("")
  const visible = useMemo(
    () => (q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.toLowerCase())) : options),
    [options, q],
  )
  const selected = new Set(value)
  const toggle = (v: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(v)
    else next.delete(v)
    onChange([...next])
  }
  return (
    <div className={cn("rounded-lg border", className)}>
      {searchable && options.length > 6 ? (
        <div className="relative border-b">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter options"
            className="h-8 w-full bg-transparent pr-2 pl-8 text-sm outline-none"
          />
        </div>
      ) : null}
      <div className="max-h-48 overflow-y-auto p-1">
        {visible.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{options.length ? "No matches." : emptyText}</p>
        ) : (
          visible.map((o) => (
            <label
              key={o.value}
              htmlFor={`${id}-${o.value}`}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                id={`${id}-${o.value}`}
                checked={selected.has(o.value)}
                onCheckedChange={(c) => toggle(o.value, Boolean(c))}
              />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint ? <span className="truncate text-xs text-muted-foreground">{o.hint}</span> : null}
            </label>
          ))
        )}
      </div>
      {options.length > 0 ? (
        <div className="flex items-center justify-between border-t px-2 py-1 text-xs text-muted-foreground">
          <span>{value.length} selected</span>
          <span className="flex gap-2">
            <button type="button" className="hover:text-foreground" onClick={() => onChange(options.map((o) => o.value))}>
              All
            </button>
            <button type="button" className="hover:text-foreground" onClick={() => onChange([])}>
              None
            </button>
          </span>
        </div>
      ) : null}
    </div>
  )
}

export function SwitchField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={(c) => onCheckedChange(Boolean(c))} disabled={disabled} />
    </div>
  )
}

export function ListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const v = draft.trim()
    if (!v) return
    onChange([...value, v])
    setDraft("")
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {value.map((item, i) => (
          <li key={`${item}-${i}`} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
            <span className="flex-1">{item}</span>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={`Remove ${item}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" onClick={add} className="rounded-lg border px-3 text-sm hover:bg-muted">
          Add
        </button>
      </div>
    </div>
  )
}
