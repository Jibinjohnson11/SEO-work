"use client"

import { useState } from "react"
import { X } from "lucide-react"

export const BRAND_KEYWORDS_LIST = "brand-keywords"

/** Suggestions (the brand's existing keywords) for the keyword inputs of a campaign form. */
export function BrandKeywordList({ keywords }: { keywords: string[] }) {
  return (
    <datalist id={BRAND_KEYWORDS_LIST}>
      {keywords.map((k) => <option key={k} value={k} />)}
    </datalist>
  )
}

/** Tag input: Enter (or comma) adds a keyword, × or Backspace on an empty field removes one. */
export function KeywordTags({ id, value, onChange, exclude, placeholder = "Type a keyword and press Enter" }: { id: string; value: string[]; onChange: (v: string[]) => void; exclude?: string; placeholder?: string }) {
  const [draft, setDraft] = useState("")
  function add() {
    const k = draft.trim().replace(/\s+/g, " ")
    setDraft("")
    if (!k || k.length > 200) return
    const lower = k.toLowerCase()
    if (lower === exclude?.trim().toLowerCase() || value.some((v) => v.toLowerCase() === lower)) return
    onChange([...value, k])
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      {value.map((k) => (
        <span key={k} className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 py-0.5 pr-1 pl-2 text-xs font-medium text-primary">
          <span className="truncate">{k}</span>
          <button type="button" className="rounded-sm p-0.5 hover:bg-primary/20" aria-label={`Remove ${k}`} onClick={() => onChange(value.filter((v) => v !== k))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        list={BRAND_KEYWORDS_LIST}
        autoComplete="off"
        value={draft}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[10rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={add}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === ",") {
            ev.preventDefault()
            add()
          } else if (ev.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1))
        }}
      />
    </div>
  )
}
