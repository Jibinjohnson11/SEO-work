import { format as fmt, formatDistanceToNowStrict } from "date-fns"
import { tz } from "@date-fns/tz"

export const DEFAULT_DATE_FORMAT = "dd MMM yyyy"

/** Formats a calendar date ("YYYY-MM-DD") without shifting it across time zones. */
export function formatDay(value: string | null | undefined, pattern = DEFAULT_DATE_FORMAT) {
  if (!value) return "—"
  const [y, m, d] = value.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return value
  return fmt(new Date(y, m - 1, d), pattern)
}

/** Formats an instant in a given time zone. */
export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone?: string,
  pattern = `${DEFAULT_DATE_FORMAT}, HH:mm`,
) {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return "—"
  return fmt(date, pattern, timeZone ? { in: tz(timeZone) } : undefined)
}

export function timeAgo(value: string | Date | null | undefined) {
  if (!value) return "—"
  return `${formatDistanceToNowStrict(typeof value === "string" ? new Date(value) : value)} ago`
}

export function formatNumber(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  return n.toLocaleString("en-US", { maximumFractionDigits: digits })
}

export function initials(name: string | null | undefined) {
  return (name || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
}
