import { notFound } from "next/navigation"
import { requireRole } from "@/lib/auth"
import { DetailList, PageHeader, Section } from "@/components/shared/page-header"
import { ToneBadge } from "@/components/shared/status-badge"
import { SnapshotActions } from "@/components/reports/report-toolbar"
import { formatDateTime, formatDay } from "@/lib/format"
import type { ExportDoc } from "@/lib/export"
import type { ReportRecord } from "@/lib/types"

export const metadata = { title: "Saved report" }

// A stored snapshot exactly as it was saved (never recalculated).
export default async function SavedReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const { supabase } = await requireRole(["super_admin"])
  const { data } = await supabase.from("reports").select("*").eq("id", id).maybeSingle()
  if (!data) notFound()
  const r = data as ReportRecord & { generated_by: string | null }
  const doc = r.data as unknown as ExportDoc
  const [{ data: author }, { data: brand }] = await Promise.all([
    r.generated_by ? supabase.from("profiles").select("full_name, email").eq("id", r.generated_by).maybeSingle() : Promise.resolve({ data: null }),
    r.client_id ? supabase.from("clients").select("company_name").eq("id", r.client_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const cell = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : v)

  return (
    <>
      <PageHeader
        title={r.title}
        description={doc.subtitle}
        actions={<SnapshotActions id={r.id} status={r.status} hasClient={Boolean(r.client_id)} />}
      />
      <Section title="Snapshot">
        <DetailList
          items={[
            { label: "Date range", value: r.period_start === r.period_end ? formatDay(r.period_start) : `${formatDay(r.period_start)} – ${formatDay(r.period_end)}` },
            { label: "Brand", value: brand?.company_name ?? "All brands" },
            { label: "Created", value: formatDateTime(r.created_at, r.timezone) },
            { label: "Created by", value: author ? author.full_name || author.email : r.is_scheduled ? "Scheduled job" : "—" },
            { label: "Time zone", value: r.timezone },
            { label: "Status", value: <ToneBadge tone={r.status === "published" ? "success" : "muted"}>{r.status === "published" ? "Published to client" : "Draft"}</ToneBadge> },
          ]}
        />
      </Section>
      {doc.sheets.map((sheet) => (
        <Section key={sheet.name} title={sheet.name} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>{sheet.columns.map((c) => <th key={c.key} scope="col" className={`px-4 py-2 font-medium whitespace-nowrap ${c.numeric ? "text-right" : "text-left"}`}>{c.header}</th>)}</tr>
              </thead>
              <tbody>
                {sheet.rows.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {sheet.columns.map((c) => <td key={c.key} className={`px-4 py-2 ${c.numeric ? "tabular text-right" : ""}`}>{cell(row[c.key])}</td>)}
                  </tr>
                ))}
                {sheet.rows.length === 0 ? <tr><td colSpan={sheet.columns.length} className="px-4 py-6 text-center text-muted-foreground">No rows.</td></tr> : null}
              </tbody>
              {sheet.footer ? (
                <tfoot className="border-t bg-muted/30 font-semibold">
                  <tr>{sheet.columns.map((c) => <td key={c.key} className={`px-4 py-2 ${c.numeric ? "tabular text-right" : ""}`}>{cell(sheet.footer?.[c.key])}</td>)}</tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </Section>
      ))}
    </>
  )
}
