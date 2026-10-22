"use client"

import { useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/shared/form"

const PERIODS = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["yearly", "Yearly"],
  ["custom", "Custom range"],
] as const
type Period = (typeof PERIODS)[number][0]

function shift(date: string, period: Period, step: number) {
  const [y, m, d] = date.split("-").map(Number)
  const dt =
    period === "daily"
      ? new Date(Date.UTC(y, m - 1, d + step))
      : period === "weekly"
        ? new Date(Date.UTC(y, m - 1, d + 7 * step))
        : period === "monthly"
          ? new Date(Date.UTC(y, m - 1 + step, 1))
          : new Date(Date.UTC(y + step, 0, 1))
  return dt.toISOString().slice(0, 10)
}

/**
 * Report period: Daily / Weekly / Monthly / Yearly pick any day, week, month or year (arrows step
 * through them); Custom takes an inclusive From – To range. Updates the URL, so the page reloads.
 */
export function PeriodPicker({ period, anchor, from, to, today }: { period: Period; anchor: string; from: string; to: string; today: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const go = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }))
  }
  const setAnchor = (date: string) => go({ period, date: date > today ? today : date, from: null, to: null })
  const canNext = period !== "custom" && shift(anchor, period, 1) <= today
  const years = Array.from({ length: 8 }, (_, i) => String(Number(today.slice(0, 4)) - i))

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">Report period</span>
        <div role="radiogroup" aria-label="Report period" className="flex h-10 flex-wrap items-center rounded-lg border bg-card p-1">
          {PERIODS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => (value === "custom" ? go({ period: value, date: null, from, to }) : go({ period: value, date: anchor, from: null, to: null }))}
              className={`h-full rounded-md px-3 text-sm transition-colors ${period === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </label>

      {period === "custom" ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">From</span>
            <Input type="date" className="h-10 w-auto" value={from} max={to} onChange={(e) => e.target.value && go({ period, from: e.target.value, to })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">To (inclusive)</span>
            <Input type="date" className="h-10 w-auto" value={to} min={from} onChange={(e) => e.target.value && go({ period, from, to: e.target.value })} />
          </label>
        </>
      ) : (
        <div className="flex items-end gap-1">
          <Button variant="outline" size="icon" className="size-10" aria-label="Previous period" onClick={() => setAnchor(shift(anchor, period, -1))}>
            <ChevronLeft />
          </Button>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">{period === "daily" ? "Day" : period === "weekly" ? "Week containing" : period === "monthly" ? "Month" : "Year"}</span>
            {period === "monthly" ? (
              <Input type="month" className="h-10 w-auto" value={anchor.slice(0, 7)} max={today.slice(0, 7)} onChange={(e) => e.target.value && setAnchor(`${e.target.value}-01`)} />
            ) : period === "yearly" ? (
              <NativeSelect className="h-10 w-28" value={anchor.slice(0, 4)} onChange={(e) => setAnchor(`${e.target.value}-01-01`)}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </NativeSelect>
            ) : (
              <Input type="date" className="h-10 w-auto" value={anchor} max={today} onChange={(e) => e.target.value && setAnchor(e.target.value)} />
            )}
          </label>
          <Button variant="outline" size="icon" className="size-10" aria-label="Next period" disabled={!canNext} onClick={() => setAnchor(shift(anchor, period, 1))}>
            <ChevronRight />
          </Button>
        </div>
      )}
      {pending ? <Loader2 className="mb-3 size-4 animate-spin text-muted-foreground" aria-label="Loading" /> : null}
    </div>
  )
}
