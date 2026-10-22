"use client"

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { Briefcase, ChevronLeft, ChevronRight, MapPin, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BrandLogo } from "@/components/shared/brand-logo"
import { CardGrid } from "@/components/shared/card-grid"
import { EmptyState } from "@/components/shared/empty-state"
import { NativeSelect } from "@/components/shared/form"

// Card grid for the Brands listing. Like DataTable, the server passes already-filtered,
// permission-checked rows; search, sorting and pagination run in the browser, so this page's
// search is independent of the global search in the top bar.

export interface BrandCardData {
  id: string
  /** Code and website are searchable but not shown on the card. */
  code: string
  name: string
  logoUrl: string | null
  industry: string | null
  country: string | null
  website: string | null
  createdAt: string
  updatedAt: string
}

const SORTS = {
  name: { label: "Name (A–Z)", cmp: (a: BrandCardData, b: BrandCardData) => compareText(a.name, b.name) },
  name_desc: { label: "Name (Z–A)", cmp: (a: BrandCardData, b: BrandCardData) => compareText(b.name, a.name) },
  newest: { label: "Newest First", cmp: (a: BrandCardData, b: BrandCardData) => b.createdAt.localeCompare(a.createdAt) },
  oldest: { label: "Oldest First", cmp: (a: BrandCardData, b: BrandCardData) => a.createdAt.localeCompare(b.createdAt) },
  updated: { label: "Recently Updated", cmp: (a: BrandCardData, b: BrandCardData) => b.updatedAt.localeCompare(a.updatedAt) },
} as const
type SortKey = keyof typeof SORTS

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

export function BrandGrid({
  brands,
  pageSize = 30,
  empty,
  action,
  filters,
}: {
  brands: BrandCardData[]
  pageSize?: number
  empty: { title: string; description?: React.ReactNode; action?: React.ReactNode }
  /** Primary toolbar button (New brand), shown to the right of Sort. */
  action?: React.ReactNode
  /** Secondary filter row (status filter and presets), shown under the toolbar. */
  filters?: React.ReactNode
}) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("name")
  const [page, setPage] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // The rows are already in the browser, so filtering is instant and needs no debounce.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = needle
      ? brands.filter((b) => [b.name, b.code, b.industry, b.country, b.website].some((v) => v?.toLowerCase().includes(needle)))
      : brands
    return [...rows].sort(SORTS[sort].cmp)
  }, [brands, query, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize)

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation()
                  setQuery("")
                  setPage(0)
                }
              }}
              placeholder="Search Brand..."
              aria-label="Search brands by name, code, industry, location or website"
              className="h-10 w-full rounded-lg border border-input bg-card pr-9 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => {
                  setQuery("")
                  setPage(0)
                  inputRef.current?.focus()
                }}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <NativeSelect
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey)
                setPage(0)
              }}
              className="h-10 min-w-0 flex-1 sm:w-48 sm:flex-none"
              aria-label="Sort brands"
            >
              {Object.entries(SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            {action}
          </div>
        </div>
        {filters}
      </div>

      {visible.length === 0 ? (
        <div className="surface border-dashed">
          {brands.length === 0 ? (
            <EmptyState title={empty.title} description={empty.description} action={empty.action} />
          ) : (
            <EmptyState
              icon={Search}
              title="No matching brands"
              description={query.trim() ? <>Nothing matches &ldquo;{query.trim()}&rdquo;. Try a name, code, industry, location or website.</> : "Try a different filter."}
              action={
                query ? (
                  <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      ) : (
        <CardGrid>
          {visible.map((b) => (
            <li key={b.id} className="min-w-0">
              <BrandCard brand={b} />
            </li>
          ))}
        </CardGrid>
      )}

      {filtered.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {filtered.length === brands.length ? `${brands.length} brands` : `${filtered.length} of ${brands.length} brands`}
          </span>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <span>
                Page {current + 1} of {pageCount}
              </span>
              <Button variant="outline" size="icon-sm" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPage(current + 1)}
                disabled={current >= pageCount - 1}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Minimal brand card: logo, name, industry and location. The whole card opens the brand. */
function BrandCard({ brand: b }: { brand: BrandCardData }) {
  return (
    <Link
      href={`/admin/clients/${b.id}`}
      className="surface surface-hover flex h-full min-w-0 cursor-pointer flex-col items-center gap-3 px-4 py-5 text-center shadow-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <BrandLogo src={b.logoUrl} name={b.name} size="lg" className="rounded-xl bg-background" />
      <h3 className="line-clamp-2 w-full text-sm leading-snug font-semibold [overflow-wrap:anywhere]" title={b.name}>
        {b.name}
      </h3>
      <dl className="w-full min-w-0 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-1.5">
          <dt className="sr-only">Industry</dt>
          <Briefcase className="size-3.5 shrink-0" aria-hidden />
          <dd className="truncate" title={b.industry ?? undefined}>{b.industry ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-center gap-1.5">
          <dt className="sr-only">Location</dt>
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <dd className="truncate" title={b.country ?? undefined}>{b.country ?? "—"}</dd>
        </div>
      </dl>
    </Link>
  )
}
