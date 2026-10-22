"use client"

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { Building2, Check, ChevronLeft, ChevronRight, Copy, Globe, History, MapPin, Pencil, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CardGrid } from "@/components/shared/card-grid"
import { EmptyState } from "@/components/shared/empty-state"
import { NativeSelect } from "@/components/shared/form"
import { CampaignStatusBadge } from "@/components/shared/status-badge"
import { CampaignFormButton, type CampaignFormOptions, type CampaignRelations } from "@/components/admin/campaign-form"
import { CampaignRowActions } from "@/components/admin/campaign-actions"
import { cn } from "@/lib/utils"
import type { Campaign } from "@/lib/types"

// Card grid for the Campaigns listing. Like BrandGrid, the server passes already-filtered,
// permission-checked rows; search, sorting and pagination run in the browser.

export interface CampaignCardData {
  campaign: Campaign
  relations: CampaignRelations
  brand: string
  /** All-time rows in published_backlinks for this campaign (not submissions). */
  published: number
  /** Verified live backlinks this month, for progress sorting. */
  verifiedLiveMonth: number
  submittedMonth: number
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 }
type Card = CampaignCardData
const progress = (c: Card) => (c.campaign.monthly_target ? c.verifiedLiveMonth / c.campaign.monthly_target : -1)

const SORTS = {
  code: { label: "Code", cmp: (a: Card, b: Card) => compareText(a.campaign.code, b.campaign.code) },
  name: { label: "Name (A–Z)", cmp: (a: Card, b: Card) => compareText(a.campaign.name, b.campaign.name) },
  brand: { label: "Brand (A–Z)", cmp: (a: Card, b: Card) => compareText(a.brand, b.brand) },
  priority: { label: "Priority", cmp: (a: Card, b: Card) => PRIORITY_RANK[a.campaign.priority] - PRIORITY_RANK[b.campaign.priority] },
  deadline: { label: "Deadline (soonest)", cmp: (a: Card, b: Card) => (a.campaign.end_date ?? "9999").localeCompare(b.campaign.end_date ?? "9999") },
  published: { label: "Most published", cmp: (a: Card, b: Card) => b.published - a.published },
  submitted: { label: "Most submitted (mo)", cmp: (a: Card, b: Card) => b.submittedMonth - a.submittedMonth },
  progress: { label: "Monthly progress", cmp: (a: Card, b: Card) => progress(b) - progress(a) },
  newest: { label: "Newest First", cmp: (a: Card, b: Card) => b.campaign.created_at.localeCompare(a.campaign.created_at) },
} as const
type SortKey = keyof typeof SORTS

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

export function CampaignGrid({
  campaigns,
  options,
  pageSize = 24,
  empty,
  action,
  filters,
}: {
  campaigns: CampaignCardData[]
  options: CampaignFormOptions
  pageSize?: number
  empty: { title: string; description?: React.ReactNode }
  /** Toolbar buttons (Export, Import, New campaign), shown to the right of Sort. */
  action?: React.ReactNode
  /** Secondary filter row (brand / status / priority and presets), shown under the toolbar. */
  filters?: React.ReactNode
}) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("code")
  const [page, setPage] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = needle
      ? campaigns.filter((c) =>
          [c.campaign.code, c.campaign.name, c.brand, c.campaign.target_url, c.campaign.target_location, c.relations.primary_keyword, ...c.relations.secondary_keywords].some((v) =>
            v?.toLowerCase().includes(needle),
          ),
        )
      : campaigns
    return [...rows].sort(SORTS[sort].cmp)
  }, [campaigns, query, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize)

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
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
              placeholder="Search code, name, keyword…"
              aria-label="Search campaigns by code, name, brand, keyword, location or URL"
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
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey)
                setPage(0)
              }}
              className="h-10 min-w-0 flex-1 sm:w-48 sm:flex-none"
              aria-label="Sort campaigns"
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
          {campaigns.length === 0 ? (
            <EmptyState title={empty.title} description={empty.description} />
          ) : (
            <EmptyState
              icon={Search}
              title="No matching campaigns"
              description={query.trim() ? <>Nothing matches &ldquo;{query.trim()}&rdquo;. Try a code, name, brand, keyword or URL.</> : "Try a different filter."}
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
          {visible.map((c) => (
            <li key={c.campaign.id} className="min-w-0">
              <CampaignCard card={c} options={options} />
            </li>
          ))}
        </CardGrid>
      )}

      {filtered.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{filtered.length === campaigns.length ? `${campaigns.length} campaigns` : `${filtered.length} of ${campaigns.length} campaigns`}</span>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <span>
                Page {current + 1} of {pageCount}
              </span>
              <Button variant="outline" size="icon-sm" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" onClick={() => setPage(current + 1)} disabled={current >= pageCount - 1} aria-label="Next page">
                <ChevronRight />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The card opens the campaign through a full-size link layered under its content, so the inner
 * controls (keyword and URL copy, Audit, Edit, More options) stay separate buttons above it.
 */
function CampaignCard({ card: c, options }: { card: CampaignCardData; options: CampaignFormOptions }) {
  const cmp = c.campaign
  const above = "relative z-10"
  const keyword = c.relations.primary_keyword
  return (
    <article className="surface surface-hover relative flex h-full min-w-0 flex-col overflow-hidden shadow-xs has-[a[data-card-link]:focus-visible]:ring-3 has-[a[data-card-link]:focus-visible]:ring-ring/50">
      <Link href={`/admin/campaigns/${cmp.id}`} data-card-link aria-label={`Open ${cmp.name}`} className="absolute inset-0 outline-none" />

      <header className="flex items-start gap-2 bg-primary px-4 py-2.5 text-primary-foreground">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">
          {keyword ? (
            <CopyButton value={keyword} message="Keyword copied!" label={`Copy keyword ${keyword}`} wrap className="max-w-full rounded text-left hover:bg-primary-foreground/15 hover:text-primary-foreground">
              {keyword}
            </CopyButton>
          ) : (
            <span className="[overflow-wrap:anywhere]">{cmp.name}</span>
          )}
        </h3>
        <div className="shrink-0">
          <CampaignStatusBadge status={cmp.status} className="bg-primary-foreground/20 text-primary-foreground ring-primary-foreground/30" />
        </div>
      </header>

      <dl className="flex-1 space-y-1.5 px-4 py-2.5 text-sm">
        <Detail label="Brand" icon={Building2}>
          <span className="block truncate font-medium" title={c.brand}>{c.brand}</span>
        </Detail>
        {cmp.target_location ? (
          <Detail label="Location" icon={MapPin}>
            <span className="block truncate" title={cmp.target_location}>{cmp.target_location}</span>
          </Detail>
        ) : null}
        <Detail label="Landing page URL" icon={Globe}>
          {cmp.target_url ? (
            <CopyButton value={cmp.target_url} message="URL copied!" label={`Copy landing page URL ${cmp.target_url}`} className="max-w-full rounded-full border border-primary/40 px-2 py-0.5 text-xs text-primary">
              {cmp.target_url.replace(/^https?:\/\/(www\.)?/, "")}
            </CopyButton>
          ) : (
            <span className="text-muted-foreground">No landing page URL</span>
          )}
        </Detail>
      </dl>

      <footer className="flex min-h-10 items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground">
        <Link
          href={`/admin/activity?entity=campaigns&q=${cmp.id}`}
          className={`${above} inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-accent px-2 font-medium text-accent-foreground hover:bg-primary hover:text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none`}
        >
          <History className="size-3.5" aria-hidden /> Audit
        </Link>
        <div className={`${above} ml-auto flex shrink-0 items-center gap-0.5`}>
          <CampaignFormButton campaign={cmp} relations={c.relations} options={options} variant="outline" aria-label={`Edit ${cmp.name}`}>
            <Pencil /> Edit
          </CampaignFormButton>
          <CampaignRowActions id={cmp.id} status={cmp.status} />
        </div>
      </footer>
    </article>
  )
}

/**
 * Copies `value` (the full original text, even when the visible text is truncated) on click, Enter or
 * Space. Sits above the card's stretched link, so it never opens the campaign.
 */
function CopyButton({ value, message, label, wrap, className, children }: { value: string; message: string; label: string; wrap?: boolean; className?: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy to the clipboard")
    }
  }
  const Icon = copied ? Check : Copy
  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      aria-label={label}
      className={cn(
        "group/copy relative z-10 inline-flex min-w-0 cursor-pointer items-center gap-1 transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <span className={wrap ? "[overflow-wrap:anywhere]" : "truncate"}>{children}</span>
      <Icon className={cn("size-3 shrink-0 transition-opacity", copied ? "text-success opacity-100" : "opacity-50 group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100")} aria-hidden />
    </button>
  )
}

/** A value-only row: the icon stands in for the label, which stays available to screen readers. */
function Detail({ label, icon: Icon, children }: { label: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <dt className="sr-only">{label}</dt>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}
