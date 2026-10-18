import { describe, expect, it } from "vitest"
import { digestEmail, reportEmail } from "@/lib/email-content"
import { renderExport, type ExportDoc } from "@/lib/export"

// Synthetic sample data only: the app's emails are built from these functions, so this is exactly
// what the daily job would send.
const APP = "https://staging.linkops.example"

describe("notification digest email", () => {
  const items = [
    { id: "n1", title: "CMP-001 approved by client", body: "Guest post on publisher.example", link: "/intern/submissions/abc" },
    { id: "n2", title: "Client requested changes on CMP-002", body: null, link: null },
  ]

  it("lists each notification with an absolute link and a footer", () => {
    const m = digestEmail(items, APP)
    expect(m.subject).toBe("You have 2 new notifications")
    expect(m.text).toBe(
      "• CMP-001 approved by client — Guest post on publisher.example\n  https://staging.linkops.example/intern/submissions/abc\n" +
        "• Client requested changes on CMP-002\n\nOpen LinkOps: https://staging.linkops.example\nYou can turn these emails off in your profile settings.",
    )
    expect(digestEmail(items.slice(0, 1), APP).subject).toBe("You have 1 new notification")
  })

  it("never turns stored text into extra lines or foreign links", () => {
    const m = digestEmail(
      [
        { id: "a", title: "Hi\r\nBcc: victim@example.com", body: "<script>alert(1)</script>\n\nfake line", link: "//evil.example/x" },
        { id: "b", title: "x", body: null, link: "https://evil.example" },
        { id: "c", title: "y", body: null, link: "javascript:alert(1)" },
      ],
      APP,
    )
    expect(m.text.split("\n")[0]).toBe("• Hi Bcc: victim@example.com — <script>alert(1)</script> fake line") // plain text: shown, never executed
    expect(m.text).not.toContain("evil.example")
    expect(m.text).not.toContain("javascript:")
  })

  it("omits links when the app URL is not configured", () => {
    expect(digestEmail(items).text).not.toContain("http")
  })

  it("has a stable duplicate-prevention key for the same notifications, in any order", () => {
    expect(digestEmail(items).idempotencyKey).toBe(digestEmail([...items].reverse()).idempotencyKey)
    expect(digestEmail(items).idempotencyKey).not.toBe(digestEmail(items.slice(0, 1)).idempotencyKey)
    expect(digestEmail(items).idempotencyKey.length).toBeLessThanOrEqual(256) // Resend's limit
  })
})

describe("scheduled report email", () => {
  const doc: ExportDoc = {
    title: "Scheduled daily backlink report",
    subtitle: "16 Oct 2026 · Asia/Kolkata",
    sheets: [
      {
        name: "Report",
        columns: [
          { key: "dim", header: "Campaign" },
          { key: "submitted", header: "Submitted", numeric: true },
        ],
        rows: [
          { dim: "CMP-001", submitted: 3 },
          { dim: "=HYPERLINK(\"https://evil.example\")", submitted: 1 },
          { dim: "Café — ünïcode", submitted: 0 },
        ],
        footer: { dim: "Total", submitted: 4, client_approved: 2, published: 1, verified_live: 1 },
      },
    ],
  }

  it("summarises the totals and names the attachment", () => {
    const m = reportEmail({ id: "r1", period_start: "2026-10-16", period_end: "2026-10-16", attempt: 1 }, doc, "csv", APP)
    expect(m.subject).toBe("Scheduled daily backlink report · 2026-10-16")
    expect(m.text).toBe(
      "16 Oct 2026 · Asia/Kolkata\n\nSubmitted: 4\nClient approved: 2\nPublished: 1\nVerified live: 1\n\nThe full report is attached (CSV).\nReports in LinkOps: https://staging.linkops.example/admin/reports",
    )
    expect(m.filename).toBe("report-2026-10-16.csv")
    expect(reportEmail({ id: "r1", period_start: "2026-10-12", period_end: "2026-10-18", attempt: 1 }, doc, "pdf").subject).toBe("Scheduled daily backlink report · 2026-10-12 – 2026-10-18")
  })

  it("shows 0 for missing totals and uses a new duplicate-prevention key per attempt", () => {
    const empty = reportEmail({ id: "r1", period_start: "2026-10-16", period_end: "2026-10-16", attempt: 1 }, { ...doc, sheets: [] }, "xlsx")
    expect(empty.text).toContain("Submitted: 0\nClient approved: 0\nPublished: 0\nVerified live: 0")
    expect(empty.idempotencyKey).toBe("linkops-report-r1-1")
    expect(reportEmail({ id: "r1", period_start: "x", period_end: "x", attempt: 2 }, doc, "csv").idempotencyKey).toBe("linkops-report-r1-2")
  })

  it("renders the attachment in every format, neutralising spreadsheet formulas", async () => {
    const csv = (await renderExport(doc, "csv")).toString("utf8")
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("Café — ünïcode")
    expect((await renderExport(doc, "xlsx")).subarray(0, 2).toString()).toBe("PK")
    expect((await renderExport(doc, "pdf")).subarray(0, 5).toString()).toBe("%PDF-")
  })
})
