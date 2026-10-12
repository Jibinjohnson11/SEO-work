import Link from "next/link"
import { cn } from "@/lib/utils"

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "default",
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  href?: string
  tone?: "default" | "success" | "warning" | "danger"
  icon?: React.ComponentType<{ className?: string }>
}) {
  const body = (
    <div
      className={cn(
        "group flex h-full flex-col gap-1 rounded-xl border bg-card p-4 transition-colors",
        href && "hover:border-primary/40 hover:bg-accent/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
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
