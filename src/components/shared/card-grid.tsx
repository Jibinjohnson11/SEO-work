import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Responsive card grid sized by its container (not the viewport), so it fits beside the sidebar:
 * 1 column on phones, 2 on tablets, 4 on large screens. Cards in a row share the same height.
 */
export function CardGrid({ children, className, as: Tag = "ul" }: { children: React.ReactNode; className?: string; as?: "ul" | "div" }) {
  return (
    <div className="@container">
      <Tag className={cn("grid auto-rows-fr grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4", className)}>{children}</Tag>
    </div>
  )
}

/** "View details" link used in card footers. */
export function ViewDetailsLink({ href, className }: { href: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      View details <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  )
}

/**
 * The standard compact card: a tinted header (title + status), a body of label/value details, and an
 * action footer (View details, Edit and other actions). Long titles are truncated; `tooltip` gives
 * the full text on hover.
 */
export function EntityCard({
  title,
  tooltip,
  badge,
  leading,
  details,
  href,
  actions,
  footerNote,
  selected,
  className,
}: {
  title: React.ReactNode
  tooltip?: string
  badge?: React.ReactNode
  /** e.g. a selection checkbox, shown before the title. */
  leading?: React.ReactNode
  details?: { label: string; value: React.ReactNode }[]
  /** Detail page; adds "View details" to the footer. */
  href?: string
  /** Footer actions (row menus, buttons). */
  actions?: React.ReactNode
  /** Small secondary content shown at the start of the footer. */
  footerNote?: React.ReactNode
  selected?: boolean
  className?: string
}) {
  return (
    <div className={cn("surface surface-hover flex h-full min-w-0 flex-col overflow-hidden shadow-xs", selected && "border-primary/60 ring-1 ring-primary/30", className)}>
      <div className="flex items-start gap-2 border-b border-primary/15 bg-primary/10 px-4 py-3">
        {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
        <div className="min-w-0 flex-1 overflow-hidden text-sm [&_*]:max-w-full [&_*]:truncate" title={tooltip}>
          {title}
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
      {details?.length ? (
        <dl className="grid flex-1 grid-cols-2 content-start gap-x-4 gap-y-2.5 px-4 py-3 text-sm">
          {details.map((d) => (
            <div key={d.label} className="min-w-0">
              <dt className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{d.label}</dt>
              <dd className="mt-0.5 min-w-0 [overflow-wrap:anywhere]">{d.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="flex-1" />
      )}
      {href || actions || footerNote ? (
        <div className="flex min-h-11 items-center gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
          {footerNote ? <div className="flex min-w-0 flex-wrap items-center gap-2">{footerNote}</div> : null}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {href ? <ViewDetailsLink href={href} /> : null}
            {actions}
          </div>
        </div>
      ) : null}
    </div>
  )
}
