"use client"

import { useEffect, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Bookmark, Loader2, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect, type Option } from "@/components/shared/form"
import { useAction } from "@/hooks/use-action"
import { deleteFilterPreset, saveFilterPreset } from "@/server/saved-filters"

export type FilterDef =
  | { type: "search"; key: string; label: string; placeholder?: string }
  | { type: "select"; key: string; label: string; options: Option[]; allLabel?: string }
  | { type: "period"; label?: string; presets?: { value: string; label: string }[] }

export const PERIOD_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7", label: "Last 7 days" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_30", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
]

export interface SavedPreset {
  id: string
  name: string
  query: string
}

/** URL-driven filters: every change updates the query string, and the server re-renders. */
export function FilterBar({
  filters,
  presets,
  defaultPeriod,
}: {
  filters: FilterDef[]
  presets?: SavedPreset[]
  defaultPeriod?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const setParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k)
      else next.set(k, v)
    }
    next.delete("page")
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }))
  }

  const active = filters.some((f) =>
    f.type === "period" ? params.has("period") || params.has("from") : params.has(f.key),
  )

  return (
    <div className="flex flex-wrap items-end gap-2">
      {filters.map((f) => {
        if (f.type === "search") return <SearchFilter key={f.key} def={f} value={params.get(f.key) ?? ""} onChange={(v) => setParams({ [f.key]: v })} />
        if (f.type === "select")
          return (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">{f.label}</span>
              <NativeSelect
                value={params.get(f.key) ?? ""}
                onChange={(e) => setParams({ [f.key]: e.target.value })}
                className="h-10 w-auto min-w-36"
              >
                <option value="">{f.allLabel ?? `All`}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )
        const period = params.get("period") ?? (params.get("from") ? "custom" : (defaultPeriod ?? ""))
        return (
          <div key="period" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">{f.label ?? "Period"}</span>
              <NativeSelect
                value={period}
                onChange={(e) =>
                  setParams(
                    e.target.value === "custom"
                      ? { period: "custom" }
                      : { period: e.target.value, from: null, to: null },
                  )
                }
                className="h-10 w-auto min-w-36"
              >
                {(f.presets ?? PERIOD_PRESETS).map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {period === "custom" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">From</span>
                  <Input type="date" className="h-10 w-auto" value={params.get("from") ?? ""} onChange={(e) => setParams({ period: "custom", from: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">To</span>
                  <Input type="date" className="h-10 w-auto" value={params.get("to") ?? ""} onChange={(e) => setParams({ period: "custom", to: e.target.value })} />
                </label>
              </>
            ) : null}
          </div>
        )
      })}
      <div className="flex items-center gap-1">
        {active ? (
          <Button
            variant="ghost"
            className="h-10"
            onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
          >
            <X /> Reset
          </Button>
        ) : null}
        {presets ? <PresetMenu presets={presets} page={pathname} query={params.toString()} /> : null}
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" /> : null}
      </div>
    </div>
  )
}

function SearchFilter({
  def,
  value,
  onChange,
}: {
  def: Extract<FilterDef, { type: "search" }>
  value: string
  onChange: (v: string) => void
}) {
  const [text, setText] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  if (lastValue !== value) {
    setLastValue(value)
    setText(value)
  }
  useEffect(() => {
    if (text === value) return
    const t = setTimeout(() => onChange(text), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{def.label}</span>
      <span className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={def.placeholder ?? "Search…"}
          className="h-10 w-56 rounded-lg border border-input bg-card pr-3 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </span>
    </label>
  )
}

function PresetMenu({ presets, page, query }: { presets: SavedPreset[]; page: string; query: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const { pending, execute } = useAction()
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" className="h-10 px-3" />}>
          <Bookmark /> Presets
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Saved filters</DropdownMenuLabel>
          {presets.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No presets yet.</p>
          ) : (
            presets.map((p) => (
              <DropdownMenuItem key={p.id} onClick={() => router.replace(`${page}${p.query ? `?${p.query}` : ""}`)}>
                <span className="flex-1 truncate">{p.name}</span>
                <button
                  type="button"
                  aria-label={`Delete ${p.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    execute(() => deleteFilterPreset(p.id))
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen(true)} disabled={!query}>
            Save current filters…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save filter preset</DialogTitle>
          </DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pending dental campaigns" />
          <DialogFooter>
            <Button
              disabled={pending || !name.trim()}
              onClick={async () => {
                const r = await execute(() => saveFilterPreset({ page, name, query }))
                if (r.ok) {
                  setOpen(false)
                  setName("")
                }
              }}
            >
              Save preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
