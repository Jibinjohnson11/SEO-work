import { requireRole } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { formatDateTime, formatDay } from "@/lib/format"
import { portalClients } from "@/server/portal"
import type { ExportDoc } from "@/lib/export"
import type { ReportRecord } from "@/lib/types"

export const metadata = { title: "Reports" }

export default async function PortalReports() {
  const { supabase, permissions } = await requireRole(["client"], "portal.reports")
  const clients = await portalClients(supabase)
  const { data } = await supabase.from("reports").select("*").eq("status", "published").order("period_start", { ascending: false }).limit(100)
  const reports = (data ?? []) as ReportRecord[]
  const canDownload = (clientId: string | null) => {
    const c = clients.find((x) => x.id === clientId)
    return Boolean(c?.can_download_reports && c.settings.allow_report_download && can(permissions, "portal.reports.download"))
  }
  return (
    <>
      <PageHeader title="Reports" description="Reports your agency has shared with you." />
      {reports.length === 0 ? <EmptyState title="No reports shared yet" /> : (
        <div className="space-y-4">
          {reports.map((r) => {
            const doc = r.data as ExportDoc
            const sheet = doc.sheets?.[0]
            return (
              <section key={r.id} className="surface overflow-hidden">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <div><h2 className="text-sm font-semibold">{r.title}</h2><p className="text-xs text-muted-foreground">{formatDay(r.period_start)} – {formatDay(r.period_end)} · shared {formatDateTime(r.published_at, r.timezone)}</p></div>
                  {canDownload(r.client_id) ? (
                    <span className="flex gap-1">{(["pdf", "xlsx", "csv"] as const).map((f) => <a key={f} href={`/api/reports/${r.id}/download?format=${f}`} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">{f.toUpperCase()}</a>)}</span>
                  ) : null}
                </header>
                {sheet ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{sheet.columns.map((c) => <th key={c.key} className={`px-3 py-2 font-medium ${c.numeric ? "text-right" : "text-left"}`}>{c.header}</th>)}</tr></thead>
                      <tbody>{sheet.rows.map((row, i) => <tr key={i} className="border-t">{sheet.columns.map((c) => <td key={c.key} className={`px-3 py-1.5 ${c.numeric ? "tabular text-right" : ""}`}>{row[c.key] ?? ""}</td>)}</tr>)}</tbody>
                      {sheet.footer ? <tfoot className="border-t font-semibold"><tr>{sheet.columns.map((c) => <td key={c.key} className={`px-3 py-1.5 ${c.numeric ? "tabular text-right" : ""}`}>{sheet.footer![c.key] ?? ""}</td>)}</tr></tfoot> : null}
                    </table>
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
