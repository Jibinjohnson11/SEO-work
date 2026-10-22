import Link from "next/link"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "default",
  icon: Icon,
  info,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  href?: string
  tone?: "default" | "success" | "warning" | "danger"
  icon?: React.ComponentType<{ className?: string }>
  /** How the number is calculated; shown as a tooltip on an info icon. */
  info?: string
}) {
  const body = (
    <div
      className={cn(
        "surface group flex h-full flex-col gap-1 p-4",
        href && "surface-hover",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
          <span className="truncate">{label}</span>
          {info ? (
            <span title={info} className="inline-flex shrink-0 cursor-help" tabIndex={0} aria-label={`How ${label} is calculated: ${info}`}>
              <Info className="size-3.5" aria-hidden />
            </span>
          ) : null}
        </span>
        {Icon ? (
          <Icon
            className={cn(
              "size-4 text-muted-foreground",
              tone === "success" && "text-success",
              tone === "warning" && "text-warning",
              tone === "danger" && "text-destructive",
            )}
          />
        ) : null}
      </div>
      <div className="tabular text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
  return href ? (
    <Link href={href} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  )
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div
          className={cn("h-full rounded-full bg-primary transition-[width]", pct >= 100 && "bg-success")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular w-9 text-right text-xs text-muted-foreground">{max > 0 ? `${pct}%` : "—"}</span>
    </div>
  )
}
