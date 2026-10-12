import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar, type FilterDef } from "@/components/shared/filter-bar"
import { StatCard } from "@/components/shared/stat-card"
import { ToneBadge } from "@/components/shared/status-badge"
import { ReportToolbar, SnapshotActions } from "@/components/reports/report-toolbar"
import { DIMENSION_LABEL, METRIC_LABEL } from "@/lib/reporting"
import { formatDateTime, formatDay } from "@/lib/format"
import { getPresets, getSetting, type SearchParams } from "@/server/queries"
import { GROUP_OPTIONS, REPORT_COLUMNS, reportContext } from "@/server/report-data"
import type { ReportRecord } from "@/lib/types"

const KIND = {
  daily: { title: "Daily Reports", period: "today" as const, presets: ["today", "yesterday", "custom"] },
  weekly: { title: "Weekly Reports", period: "this_week" as const, presets: ["this_week", "last_week", "last_7", "custom"] },
  monthly: { title: "Monthly Reports", period: "this_month" as const, presets: ["this_month", "last_month", "last_30", "custom"] },
}
const PRESET_LABEL: Record<string, string> = { today: "Today", yesterday: "Yesterday", this_week: "This week", last_week: "Last week", last_7: "Last 7 days", this_month: "This month", last_month: "Last month", last_30: "Last 30 days", custom: "Custom range" }

export async function ReportView({ kind, searchParams }: { kind: "daily" | "weekly" | "monthly"; searchParams: SearchParams }) {
  const { supabase } = await requireRole(["super_admin"])
  const [reports, presets] = await Promise.all([getSetting("reports"), getPresets(supabase, `/admin/reports/${kind}`)])
  const ctx = await reportContext(supabase, searchParams, { period: KIND[kind].period, reportTz: reports.timezone })
  const { report, matrix, period, groupBy, lookups, timeZone, filters } = ctx
  const range = period.from === period.to ? formatDay(period.from) : `${formatDay(period.from)} – ${formatDay(period.to)}`
  const query = new URLSearchParams(Object.entries(searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()
  const { data: snaps } = await supabase.from("reports").select("*").eq("kind", kind).order("created_at", { ascending: false }).limit(20)

  const filterDefs: FilterDef[] = [
    { type: "period", presets: KIND[kind].presets.map((v) => ({ value: v, label: PRESET_LABEL[v] })) },
    { type: "select", key: "group", label: "Group by", allLabel: "Campaign", options: GROUP_OPTIONS.filter((g) => g !== "campaign").map((g) => ({ value: g, label: DIMENSION_LABEL[g] })) },
    { type: "select", key: "client", label: "Client", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
    { type: "select", key: "campaign", label: "Campaign", options: lookups.campaigns.filter((c) => !filters.client || c.client_id === filters.client).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })) },
    { type: "select", key: "intern", label: "Intern", options: lookups.interns.map((i) => ({ value: i.id, label: i.full_name || i.email })) },
    { type: "select", key: "type", label: "Backlink type", options: lookups.types.map((t) => ({ value: t.id, label: t.name })) },
  ]
  const t = report.totals

  return (
    <>
      <PageHeader
        title={KIND[kind].title}
        description={`${range} · time zone ${timeZone}. Each event is counted on the date it happened; a submission is never counted twice for the same milestone.`}
        actions={<ReportToolbar kind={kind} query={query} clientSelected={Boolean(filters.client)} defaultTitle={`${KIND[kind].title.replace(/s$/, "")} · ${range}${filters.client ? ` · ${lookups.clients.find((c) => c.id === filters.client)?.company_name}` : ""}`} />}
      />
      <FilterBar filters={filterDefs} presets={presets} defaultPeriod={KIND[kind].period} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {REPORT_COLUMNS.map((m) => (
          <StatCard key={m} label={METRIC_LABEL[m]} value={t[m]} tone={m === "verified_live" ? "success" : m === "rejected" && t[m] ? "danger" : "default"} hint={m === "pending" ? "Still open, of those submitted" : m === "target" ? "From assigned tasks" : undefined} />
        ))}
      </div>

      <Section title="Submitted by campaign and backlink type" description="All active campaigns are listed, including those with no activity" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">Campaign</th>
                {matrix.columns.map((c) => <th key={c.id} scope="col" className="px-4 py-2 text-right font-medium whitespace-nowrap">{c.label}</th>)}
                <th scope="col" className="px-4 py-2 text-right font-medium">Total Submitted</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-medium">{r.label}</th>
                  {matrix.columns.map((c) => <td key={c.id} className={`tabular px-4 py-2 text-right ${r.cells[c.id] ? "" : "text-muted-foreground/60"}`}>{r.cells[c.id]}</td>)}
                  <td className="tabular px-4 py-2 text-right font-semibold">{r.total}</td>
                </tr>
              ))}
              {matrix.rows.length === 0 ? <tr><td className="px-4 py-6 text-center text-muted-foreground" colSpan={2}>No active campaigns.</td></tr> : null}
            </tbody>
            {matrix.rows.length ? (
              <tfoot className="border-t bg-muted/30 font-semibold">
                <tr>
                  <th scope="row" className="px-4 py-2 text-left">Total</th>
                  {matrix.columns.map((c) => <td key={c.id} className="tabular px-4 py-2 text-right">{matrix.columnTotals[c.id]}</td>)}
                  <td className="tabular px-4 py-2 text-right">{matrix.total}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Section>

      <DataTable
        caption={`Report by ${DIMENSION_LABEL[groupBy]}`}
        searchPlaceholder={`Filter ${DIMENSION_LABEL[groupBy].toLowerCase()}…`}
        columns={[{ key: "dim", header: DIMENSION_LABEL[groupBy], sortable: true }, ...REPORT_COLUMNS.map((m) => ({ key: m, header: METRIC_LABEL[m], sortable: true, align: "right" as const }))]}
        rows={[
          ...report.rows.map((r) => ({
            id: r.key,
            search: r.dims[groupBy]?.label,
            sort: { dim: groupBy === "date" ? r.dims.date!.id : r.dims[groupBy]!.label, ...Object.fromEntries(REPORT_COLUMNS.map((m) => [m, r[m]])) },
            cells: { dim: groupBy === "date" ? formatDay(r.dims.date!.id) : r.dims[groupBy]!.label, ...Object.fromEntries(REPORT_COLUMNS.map((m) => [m, r[m]])) },
          })),
        ]}
        empty={{ title: "No activity in this period" }}
      />
      {report.rows.length ? (
        <p className="text-right text-xs text-muted-foreground">
          Totals: {REPORT_COLUMNS.map((m) => `${METRIC_LABEL[m]} ${t[m]}`).join(" · ")}
        </p>
      ) : null}

      <Section title="Saved snapshots" description="Frozen copies of this report. Publish single-client snapshots to the client portal." bodyClassName="p-0">
        {(snaps ?? []).length === 0 ? <p className="p-4 text-sm text-muted-foreground">No snapshots yet.</p> : (
          <ul>
            {((snaps ?? []) as ReportRecord[]).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-sm last:border-0">
                <span>
                  <span className="font-medium">{r.title}</span> {r.is_scheduled ? <ToneBadge tone="neutral">Scheduled</ToneBadge> : null}{" "}
                  <ToneBadge tone={r.status === "published" ? "success" : "muted"}>{r.status === "published" ? "Published to client" : "Draft"}</ToneBadge>
                  <span className="block text-xs text-muted-foreground">{formatDay(r.period_start)} – {formatDay(r.period_end)} · {r.client_id ? lookups.clients.find((c) => c.id === r.client_id)?.company_name : "All clients"} · saved {formatDateTime(r.created_at, timeZone)}</span>
                </span>
                <SnapshotActions id={r.id} status={r.status} hasClient={Boolean(r.client_id)} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
