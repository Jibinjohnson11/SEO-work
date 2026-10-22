// Pure helpers for the "Assign work" form and createTasks (shared so the preview matches what is saved).

/**
 * Per-member quantities. "each" gives everyone the full target; "shared" splits it so the
 * members' targets add up to exactly the total (earlier members take the remainder), which keeps
 * a shared team target from being counted once per member in reports.
 */
export function splitTarget(total: number, members: number, mode: "each" | "shared"): number[] {
  if (members <= 0) return []
  if (mode === "each") return Array(members).fill(total)
  const base = Math.floor(total / members)
  const extra = total % members
  return Array.from({ length: members }, (_, i) => base + (i < extra ? 1 : 0))
}

/** Generated task title, e.g. "best crm software · Guest post" or "… · shared 10". */
export function taskTitle(keyword: string, backlinkType: string | null, sharedTotal?: number) {
  const title = `${keyword} · ${backlinkType ?? "Backlinks"}${sharedTotal ? ` · shared ${sharedTotal}` : ""}`
  return title.length > 200 ? `${title.slice(0, 199)}…` : title
}

export const CADENCE_UNIT = { one_off: "total", daily: "day", weekly: "week", monthly: "month" } as const
