"use client"

import { useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts"
import { Table2, ChartLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/empty-state"
import { formatDay } from "@/lib/format"

// Chart conventions: categorical hues in fixed slot order (validated palette in globals.css),
// 2px lines, rounded bar ends on the baseline, recessive grid, one y-axis, a legend for 2+
// series, a crosshair/hover tooltip, and a table view for every chart.

export interface Series {
  key: string
  label: string
  /** Slot 1-6 in the categorical palette, or "reference" for a neutral comparison bar. */
  slot: number | "reference"
}

const color = (s: Series) => (s.slot === "reference" ? "var(--muted-foreground)" : `var(--chart-${s.slot})`)
const AXIS = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const

function ChartFrame({
  title,
  description,
  table,
  empty,
  children,
}: {
  title: string
  description?: string
  table: React.ReactNode
  empty: boolean
  children: React.ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {!empty ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setAsTable((v) => !v)}
            aria-label={asTable ? "Show chart" : "Show as table"}
            title={asTable ? "Show chart" : "Show as table"}
          >
            {asTable ? <ChartLine /> : <Table2 />}
          </Button>
        ) : null}
      </header>
      <div className="p-4">
        {empty ? (
          <EmptyState title="No data for this selection" description="Activity will appear here once work is recorded." />
        ) : asTable ? (
          <div className="max-h-80 overflow-auto">{table}</div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

function DataTableView({ rows, categoryKey, categoryLabel, series }: { rows: Record<string, string | number>[]; categoryKey: string; categoryLabel: string; series: Series[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="py-1.5 text-left font-medium">{categoryLabel}</th>
          {series.map((s) => (
            <th key={s.key} className="py-1.5 text-right font-medium">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0">
            <td className="py-1.5">{String(r[categoryKey])}</td>
            {series.map((s) => (
              <td key={s.key} className="tabular py-1.5 text-right">
                {r[s.key] ?? 0}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TooltipBox({
  active,
  payload,
  label,
  formatLabel,
}: {
  active?: boolean
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[]
  label?: string
  formatLabel?: (l: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{formatLabel ? formatLabel(String(label)) : label}</div>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={p.dataKey} className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            <span className="flex-1">{p.name}</span>
            <span className="tabular font-medium text-foreground">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const legendFormatter = (value: string) => <span className="text-xs text-muted-foreground">{value}</span>

export function TimeSeriesChart({
  title,
  description,
  data,
  series,
}: {
  title: string
  description?: string
  data: ({ date: string } & Record<string, number | string>)[]
  series: Series[]
}) {
  const empty = data.every((d) => series.every((s) => !Number(d[s.key])))
  const shortDay = (d: string) => formatDay(d, "d MMM")
  return (
    <ChartFrame
      title={title}
      description={description}
      empty={empty}
      table={<DataTableView rows={data.map((d) => ({ ...d, date: formatDay(d.date) }))} categoryKey="date" categoryLabel="Date" series={series} />}
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="date" tickFormatter={shortDay} {...AXIS} minTickGap={24} />
            <YAxis allowDecimals={false} {...AXIS} />
            <Tooltip content={<TooltipBox formatLabel={(l) => formatDay(l)} />} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
            <Legend iconType="circle" iconSize={8} formatter={legendFormatter} />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={color(s)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  )
}

export function CategoryBarChart({
  title,
  description,
  data,
  series,
  categoryLabel = "Category",
  layout = "vertical",
  height,
}: {
  title: string
  description?: string
  data: ({ name: string } & Record<string, number | string>)[]
  series: Series[]
  categoryLabel?: string
  /** "vertical" = horizontal bars (long category names), "horizontal" = columns. */
  layout?: "vertical" | "horizontal"
  height?: number
}) {
  const empty = data.length === 0 || data.every((d) => series.every((s) => !Number(d[s.key])))
  const single = series.length === 1
  const h = height ?? (layout === "vertical" ? Math.max(180, data.length * (single ? 32 : 44) + 40) : 288)
  return (
    <ChartFrame
      title={title}
      description={description}
      empty={empty}
      table={<DataTableView rows={data} categoryKey="name" categoryLabel={categoryLabel} series={series} />}
    >
      <div style={{ height: h }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout={layout}
            margin={{ top: 4, right: single ? 32 : 8, bottom: 0, left: layout === "vertical" ? 8 : -16 }}
            barGap={2}
            barCategoryGap={single ? "25%" : "20%"}
          >
            <CartesianGrid horizontal={layout === "horizontal"} vertical={layout === "vertical"} stroke="var(--border)" />
            {layout === "vertical" ? (
              <>
                <XAxis type="number" allowDecimals={false} {...AXIS} />
                <YAxis type="category" dataKey="name" width={120} {...AXIS} tick={{ fontSize: 11, fill: "var(--foreground)" }} />
              </>
            ) : (
              <>
                <XAxis dataKey="name" {...AXIS} interval={0} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis allowDecimals={false} {...AXIS} />
              </>
            )}
            <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
            {single ? null : <Legend iconType="circle" iconSize={8} formatter={legendFormatter} />}
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={color(s)}
                fillOpacity={s.slot === "reference" ? 0.35 : 1}
                radius={layout === "vertical" ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                maxBarSize={28}
              >
                {single ? (
                  <LabelList dataKey={s.key} position={layout === "vertical" ? "right" : "top"} className="fill-muted-foreground text-[11px]" />
                ) : null}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  )
}
