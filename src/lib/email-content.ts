import { createHash } from "node:crypto"
import type { ExportDoc } from "@/lib/export"

/**
 * Subject and body of the app's own emails (plain text: no markup to escape or break on mobile).
 * Kept free of I/O so the daily job and the tests build exactly the same message.
 */

export type DigestItem = { id: string; title: string; body: string | null; link?: string | null }

/** Absolute link for an in-app path; anything that is not a plain "/path" is dropped. */
function appLink(appUrl: string | undefined, link: string | null | undefined) {
  if (!appUrl || !link || !link.startsWith("/") || link.startsWith("//")) return null
  return appUrl.replace(/\/$/, "") + link
}

/** Collapses line breaks so stored text cannot fake extra lines or headers in the message. */
function oneLine(s: string) {
  return s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim()
}

export function digestEmail(items: DigestItem[], appUrl?: string) {
  const lines = items.map((i) => {
    const link = appLink(appUrl, i.link)
    return `• ${oneLine(i.title)}${i.body ? ` — ${oneLine(i.body)}` : ""}${link ? `\n  ${link}` : ""}`
  })
  const footer = appUrl ? `\n\nOpen LinkOps: ${appUrl.replace(/\/$/, "")}\nYou can turn these emails off in your profile settings.` : ""
  return {
    subject: `You have ${items.length} new notification${items.length === 1 ? "" : "s"}`,
    text: lines.join("\n") + footer,
    /** Same notifications → same key, so a retried request cannot deliver the digest twice. */
    idempotencyKey: `linkops-digest-${createHash("sha256").update(items.map((i) => i.id).sort().join(",")).digest("hex").slice(0, 32)}`,
  }
}

export function reportEmail(
  report: { id: string; period_start: string; period_end: string; attempt: number },
  doc: Pick<ExportDoc, "title" | "subtitle" | "sheets">,
  format: string,
  appUrl?: string,
) {
  const totals = (doc.sheets[0]?.footer ?? {}) as Record<string, unknown>
  const period = report.period_start === report.period_end ? report.period_start : `${report.period_start} – ${report.period_end}`
  const n = (k: string) => Number(totals[k] ?? 0) || 0
  return {
    subject: `${oneLine(doc.title)} · ${period}`,
    text:
      `${doc.subtitle ? `${oneLine(doc.subtitle)}\n\n` : ""}` +
      `Submitted: ${n("submitted")}\nClient approved: ${n("client_approved")}\nPublished: ${n("published")}\nVerified live: ${n("verified_live")}` +
      `\n\nThe full report is attached (${format.toUpperCase()}).` +
      (appUrl ? `\nReports in LinkOps: ${appUrl.replace(/\/$/, "")}/admin/reports` : ""),
    filename: `report-${report.period_start}.${format}`,
    /** One key per delivery attempt: retries inside an attempt are deduplicated by Resend. */
    idempotencyKey: `linkops-report-${report.id}-${report.attempt}`,
  }
}
