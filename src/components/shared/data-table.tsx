"use client"

import { cloneElement, isValidElement, useMemo, useState } from "react"
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
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/shared/empty-state"
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

export interface DataRow {
  id: string
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
}) {
  const [globalFilter, setGlobalFilter] = useState("")
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
      {searchPlaceholder !== false || toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder !== false ? (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
              <input
                value={globalFilter}
                onChange={(e) => {
                  setGlobalFilter(e.target.value)
                  table.setPageIndex(0)
                }}
                placeholder={searchPlaceholder}
                aria-label="Search table"
                className="h-8 w-full rounded-lg border border-input bg-transparent pr-2 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </div>
          ) : null}
          {toolbar}
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

      <div className="overflow-hidden rounded-xl border bg-card">
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
