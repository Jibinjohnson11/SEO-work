"use client"

import { cloneElement, isValidElement, useMemo, useState, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, LayoutGrid, List, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { CardGrid, EntityCard } from "@/components/shared/card-grid"
import { EmptyState } from "@/components/shared/empty-state"
import { NativeSelect } from "@/components/shared/form"
import { cn } from "@/lib/utils"

// Generic table: server pages pass pre-rendered cells plus sortable/searchable values, so
// no per-page client code is needed. Sorting, search and pagination run in the browser over
// the (already permission-filtered, server-filtered) rows.

export interface DataColumn {
  key: string
  header: string
  sortable?: boolean
  align?: "left" | "right" | "center"
  className?: string
}

export interface BulkProps {
  selectedIds?: string[]
  clear?: () => void
}

/**
 * Optional card view built from the same cells: `title` and `badge` (status) form the card header,
 * every other column becomes a label/value pair, and `actions` plus any header-less columns go in
 * the footer next to "View details" (when the row has an `href`). Viewers switch between cards and table; the choice is remembered per page in this browser.
 */
export interface CardLayout {
  title: string
  badge?: string
  actions?: string
  /** Columns left out of the card (still shown in the table). */
  hide?: string[]
  defaultView?: View
  /** Needed when a page has more than one card-capable table, so each remembers its own view. */
  storageKey?: string
}

type View = "cards" | "table"

// Remembered view per page. localStorage may be unavailable (private mode, previews), so an
// in-memory copy keeps the toggle working for the session either way.
const viewMemory = new Map<string, View>()
const viewListeners = new Set<() => void>()
function useStoredView(key: string, fallback: View): [View, (v: View) => void] {
  const read = (): View => {
    const mem = viewMemory.get(key)
    if (mem) return mem
    try {
      const v = window.localStorage.getItem(key)
      return v === "cards" || v === "table" ? v : fallback
    } catch {
      return fallback
    }
  }
  const view = useSyncExternalStore(
    (cb) => {
      viewListeners.add(cb)
      return () => viewListeners.delete(cb)
    },
    read,
    () => fallback,
  )
  const set = (v: View) => {
    viewMemory.set(key, v)
    try {
      window.localStorage.setItem(key, v)
    } catch {
      // per-session only
    }
    viewListeners.forEach((l) => l())
  }
  return [view, set]
}

export interface DataRow {
  id: string
  /** Detail page for the row; card view shows a "View details" action. */
  href?: string
  cells: Record<string, React.ReactNode>
  sort?: Record<string, string | number | null>
  search?: string
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
})
const helper = createColumnHelper<typeof features, DataRow>()

export function DataTable({
  columns,
  rows,
  searchPlaceholder = "Search…",
  pageSize = 25,
  empty,
  toolbar,
  dense,
  caption,
  bulk,
  cards,
}: {
  columns: DataColumn[]
  rows: DataRow[]
  searchPlaceholder?: string | false
  pageSize?: number
  empty?: { title: string; description?: React.ReactNode; action?: React.ReactNode }
  toolbar?: React.ReactNode
  dense?: boolean
  caption?: string
  /** Client component element; receives `selectedIds` and `clear` props when rows are selected. */
  bulk?: React.ReactElement<BulkProps>
  cards?: CardLayout
}) {
  const [globalFilter, setGlobalFilter] = useState("")
  const pathname = usePathname()
  const [storedView, setView] = useStoredView(`linkops:view:${pathname}${cards?.storageKey ? `:${cards.storageKey}` : ""}`, cards?.defaultView ?? "cards")
  const view: View = cards ? storedView : "table"
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const tableColumns = useMemo(
    () =>
      helper.columns([
      helper.accessor((r) => r.search ?? "", { id: "__search", header: "", enableSorting: false }),
      ...columns.map((c) =>
        helper.accessor((r) => r.sort?.[c.key] ?? null, {
          id: c.key,
          header: c.header,
          enableSorting: Boolean(c.sortable),
          enableGlobalFilter: false,
          sortUndefined: "last",
          sortFn: (a, b, id) => {
            const x = a.getValue(id) as string | number | null
            const y = b.getValue(id) as string | number | null
            if (x === y) return 0
            if (x === null) return 1
            if (y === null) return -1
            if (typeof x === "number" && typeof y === "number") return x - y
            return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" })
          },
        }),
      ),
    ]),
    [columns],
  )

  const table = useTable({
    features,
    columns: tableColumns,
    data: rows,
    getRowId: (r) => r.id,
    initialState: { pagination: { pageIndex: 0, pageSize }, columnFilters: [], sorting: [] },
    state: { globalFilter },
    onGlobalFilterChange: (v) => setGlobalFilter(typeof v === "function" ? v(globalFilter) : v),
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: (column) => column.id === "__search",
  })

  const visibleRows = table.getRowModel().rows
  const filteredCount = table.getFilteredRowModel().rows.length
  const pageIndex = table.state.pagination.pageIndex
  const pageCount = Math.max(1, table.getPageCount())
  const colMap = new Map(columns.map((c) => [c.key, c]))
  const sortable = columns.filter((c) => c.sortable)
  const sorting = table.state.sorting[0]
  const filteredIds = table.getFilteredRowModel().rows.map((r) => r.id)
  const liveSelected = [...selected].filter((id) => rows.some((r) => r.id === id))
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id))
  const toggleAll = (on: boolean) => setSelected(on ? new Set(filteredIds) : new Set())
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <div className="space-y-3">
      {searchPlaceholder !== false || toolbar || cards ? (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder !== false ? (
            <div className="relative min-w-0 flex-1 basis-56">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={globalFilter}
                onChange={(e) => {
                  setGlobalFilter(e.target.value)
                  table.setPageIndex(0)
                }}
                placeholder={searchPlaceholder}
                aria-label="Search records"
                className="h-10 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </div>
          ) : null}
          {toolbar}
          {cards && view === "cards" && sortable.length ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="shrink-0">Sort by</span>
              <NativeSelect
                className="h-10 w-full sm:w-48"
                aria-label="Sort records"
                value={sorting ? `${sorting.id}:${sorting.desc ? "desc" : "asc"}` : ""}
                onChange={(e) => {
                  const [id, dir] = e.target.value.split(":")
                  table.setSorting(id ? [{ id, desc: dir === "desc" }] : [])
                }}
              >
                <option value="">Default order</option>
                {sortable.flatMap((c) => [
                  <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.header} (ascending)</option>,
                  <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.header} (descending)</option>,
                ])}
              </NativeSelect>
            </label>
          ) : null}
          {cards && view === "cards" && bulk ? (
            <label className="flex h-10 items-center gap-2 rounded-lg border px-3 text-xs">
              <Checkbox checked={allFilteredSelected} onCheckedChange={(c) => toggleAll(Boolean(c))} aria-label="Select all" />
              Select all
            </label>
          ) : null}
          {cards ? (
            <div role="group" aria-label="Layout" className="ml-auto flex h-10 items-center rounded-lg border bg-card p-1">
              {([["cards", LayoutGrid, "Card view"], ["table", List, "Table view"]] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-label={label}
                  aria-pressed={view === v}
                  title={label}
                  onClick={() => setView(v)}
                  className={cn(
                    "flex h-full items-center rounded-md px-2.5 text-muted-foreground transition-colors hover:text-foreground",
                    view === v && "bg-muted text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {bulk && liveSelected.length > 0 && isValidElement(bulk) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-accent/50 px-3 py-2 text-sm">
          <span className="font-medium">{liveSelected.length} selected</span>
          {cloneElement(bulk, { selectedIds: liveSelected, clear: () => setSelected(new Set()) })}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      {view === "cards" && cards ? (
        visibleRows.length === 0 ? (
          <div className="surface border-dashed">
            {rows.length === 0 && empty ? (
              <EmptyState title={empty.title} description={empty.description} action={empty.action} />
            ) : (
              <EmptyState icon={Search} title="No matching records" description="Try a different search or filter." />
            )}
          </div>
        ) : (
          <CardGrid>
            {visibleRows.map((row) => {
              const cells = row.original.cells
              const placed = new Set([cards.title, cards.badge, cards.actions, ...(cards.hide ?? [])])
              const rest = columns.filter((c) => !placed.has(c.key))
              const footerKeys = [cards.actions, ...rest.filter((c) => !c.header).map((c) => c.key)].filter((k): k is string => !!k && cells[k] != null)
              return (
                <li key={row.id} className="min-w-0">
                  <EntityCard
                    selected={selected.has(row.id)}
                    leading={bulk ? <Checkbox checked={selected.has(row.id)} onCheckedChange={(c) => toggle(row.id, Boolean(c))} aria-label="Select" /> : undefined}
                    title={cells[cards.title]}
                    tooltip={typeof row.original.sort?.[cards.title] === "string" ? (row.original.sort[cards.title] as string) : undefined}
                    badge={cards.badge ? cells[cards.badge] : undefined}
                    href={row.original.href}
                    actions={footerKeys.length ? footerKeys.map((k) => <span key={k}>{cells[k]}</span>) : undefined}
                    details={rest.filter((c) => c.header).map((c) => ({ label: c.header, value: cells[c.key] ?? <span className="text-muted-foreground">—</span> }))}
                  />
                </li>
              )
            })}
          </CardGrid>
        )
      ) : (
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead className="border-b bg-muted/40">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {bulk ? (
                    <th className="w-8 px-3">
                      <Checkbox checked={allFilteredSelected} onCheckedChange={(c) => toggleAll(Boolean(c))} aria-label="Select all" />
                    </th>
                  ) : null}
                  {group.headers
                    .filter((h) => h.column.id !== "__search")
                    .map((header) => {
                      const col = colMap.get(header.column.id)!
                      const sorted = header.column.getIsSorted()
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                          className={cn(
                            "h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground",
                            col.align === "right" && "text-right",
                            col.align === "center" && "text-center",
                            col.className,
                          )}
                        >
                          {col.sortable ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={cn(
                                "inline-flex items-center gap-1 hover:text-foreground",
                                col.align === "right" && "flex-row-reverse",
                              )}
                            >
                              {col.header}
                              {sorted === "asc" ? (
                                <ArrowUp className="size-3" />
                              ) : sorted === "desc" ? (
                                <ArrowDown className="size-3" />
                              ) : (
                                <ArrowUpDown className="size-3 opacity-40" />
                              )}
                            </button>
                          ) : (
                            col.header
                          )}
                        </th>
                      )
                    })}
                </tr>
              ))}
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30" data-selected={selected.has(row.id) || undefined}>
                  {bulk ? (
                    <td className="w-8 px-3">
                      <Checkbox checked={selected.has(row.id)} onCheckedChange={(c) => toggle(row.id, Boolean(c))} aria-label="Select row" />
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-3 align-middle",
                        dense ? "py-1.5" : "py-2.5",
                        col.align === "right" && "tabular text-right",
                        col.align === "center" && "text-center",
                        col.className,
                      )}
                    >
                      {row.original.cells[col.key] ?? <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleRows.length === 0 ? (
          rows.length === 0 && empty ? (
            <EmptyState title={empty.title} description={empty.description} action={empty.action} />
          ) : (
            <EmptyState title="No matching records" description="Try a different search or filter." />
          )
        ) : null}
      </div>
      )}

      {filteredCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {filteredCount === rows.length ? `${rows.length} records` : `${filteredCount} of ${rows.length} records`}
          </span>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <span>
                Page {pageIndex + 1} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
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
