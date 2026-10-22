import Link from "next/link"
import { AlertTriangle, BadgeCheck, CheckCircle2, ClipboardList, Globe, Hourglass, Percent, Radar, Send } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar, type FilterDef } from "@/components/shared/filter-bar"
import { ProgressBar, StatCard } from "@/components/shared/stat-card"
import { ToneBadge } from "@/components/shared/status-badge"
import { PeriodPicker } from "@/components/reports/period-picker"
import { ReportToolbar, SnapshotActions } from "@/components/reports/report-toolbar"
import { formatDateTime, formatDay } from "@/lib/format"
import type { ReportRecord } from "@/lib/types"
import { getPresets, getSetting, type SearchParams } from "@/server/queries"
import {
  filterSummary,
  REPORT_GROUPS,
  REPORT_PERIODS,
  REPORT_STATUSES,
  UNIFIED_LABEL,
  UNIFIED_METRICS,
  unifiedReport,
  type ReportPeriod,
} from "@/server/unified-report"

export const metadata = { title: "Reports" }

const KIND_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Custom range" }

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [{ timezone }, presets, snapsRes] = await Promise.all([
    getSetting("reports"),
    getPresets(supabase, "/admin/reports"),
    supabase.from("reports").select("*").order("created_at", { ascending: false }).limit(200),
  ])
  const ctx = await unifiedReport(supabase, sp, timezone)
  const { range, group, rows, totals, completion, matrix, lookups, filters } = ctx
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()
  const note = filterSummary(ctx)

  const snaps = (snapsRes.data ?? []) as (ReportRecord & { generated_by: string | null })[]
  const authorIds = [...new Set(snaps.map((s) => s.generated_by).filter((x): x is string => !!x))]
  const { data: authors } = authorIds.length ? await supabase.from("profiles").select("id, full_name, email").in("id", authorIds) : { data: [] }
  const authorName = Object.fromEntries((authors ?? []).map((a) => [a.id, a.full_name || a.email]))
  const snapType = (r: ReportRecord) => {
    const p = (r.filters as Record<string, string> | null)?.period
    return p && p in REPORT_PERIODS ? REPORT_PERIODS[p as ReportPeriod] : (KIND_LABEL[r.kind] ?? r.kind)
  }

  const filterDefs: FilterDef[] = [
    { type: "select", key: "client", label: "Brand", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
    { type: "select", key: "campaign", label: "Campaign", options: lookups.campaigns.filter((c) => !filters.client || c.client_id === filters.client).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })) },
    { type: "select", key: "intern", label: "Team member", options: lookups.interns.map((i) => ({ value: i.id, label: i.full_name || i.email })) },
    { type: "select", key: "type", label: "Backlink type", options: lookups.types.map((t) => ({ value: t.id, label: t.name })) },
    { type: "select", key: "status", label: "Report status", options: Object.entries(REPORT_STATUSES).map(([value, s]) => ({ value, label: s.label })) },
    { type: "select", key: "group", label: "Group by", allLabel: "Campaign", options: Object.entries(REPORT_GROUPS).filter(([k]) => k !== "campaign").map(([value, g]) => ({ value, label: g.label })) },
  ]
  const byType = group === "backlink_type"
  const tone = (v: number | null) => (v === null ? "muted" : v >= 100 ? "success" : v >= 60 ? "info" : "warning")

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${REPORT_PERIODS[range.period]} · ${range.label} · time zone ${timezone}. Each event counts once, on the date it happened (inclusive of both ends of the range).`}
        actions={
          <ReportToolbar
            query={query}
            clientSelected={Boolean(filters.client)}
            defaultTitle={`${REPORT_PERIODS[range.period]} report · ${range.label}${note ? ` · ${note}` : ""}`}
          />
        }
      />

      <div className="space-y-3">
        <PeriodPicker period={range.period} anchor={range.anchor} from={range.from} to={range.to} today={range.today} />
        <FilterBar filters={filterDefs} presets={presets} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={UNIFIED_LABEL.target} value={totals.target} icon={ClipboardList} hint="From assigned tasks" />
        <StatCard label={UNIFIED_LABEL.submitted} value={totals.submitted} icon={Send} />
        <StatCard label={UNIFIED_LABEL.client_approved} value={totals.client_approved} icon={BadgeCheck} tone="success" />
        <StatCard label={UNIFIED_LABEL.published} value={totals.published} icon={Globe} />
        <StatCard label={UNIFIED_LABEL.verified_live} value={totals.verified_live} icon={Radar} tone="success" />
        <StatCard label={UNIFIED_LABEL.rejected} value={totals.rejected} icon={AlertTriangle} tone={totals.rejected ? "danger" : "default"} />
        <StatCard label={UNIFIED_LABEL.awaiting} value={totals.awaiting} icon={Hourglass} tone={totals.awaiting ? "warning" : "default"} hint="Submitted in period, not yet decided by the client" />
        <StatCard label="Completion" value={completion === null ? "—" : `${completion}%`} icon={completion !== null && completion >= 100 ? CheckCircle2 : Percent} tone={completion !== null && completion >= 100 ? "success" : "default"} hint="Submitted ÷ assigned target" />
      </div>

      <div>
        <h2 className="text-sm font-semibold">Report details · by {REPORT_GROUPS[group].label}</h2>
        <p className="text-xs text-muted-foreground">{range.label}{note ? ` · ${note}` : ""}</p>
      </div>
      <DataTable
        cards={{ title: group === "client" ? "brand" : group === "intern" ? "intern" : byType ? "type" : "campaign", badge: "completion", storageKey: "details" }}
        caption={`Report by ${REPORT_GROUPS[group].label}`}
        searchPlaceholder={`Filter ${REPORT_GROUPS[group].label.toLowerCase()}…`}
        columns={[
          { key: "period", header: "Report Period" },
          { key: "brand", header: "Brand", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "intern", header: "Team Member", sortable: true },
          ...(byType ? [{ key: "type", header: "Backlink Type", sortable: true }] : []),
          { key: "target", header: "Assigned Target", sortable: true, align: "right" as const },
          { key: "submitted", header: "Submitted", sortable: true, align: "right" as const },
          { key: "client_approved", header: "Approved", sortable: true, align: "right" as const },
          { key: "published", header: "Published", sortable: true, align: "right" as const },
          { key: "verified_live", header: "Verified", sortable: true, align: "right" as const },
          { key: "awaiting", header: "Pending", sortable: true, align: "right" as const },
          { key: "completion", header: "Completion Rate", sortable: true },
        ]}
        rows={rows.map((r) => ({
          id: r.key,
          search: `${r.brand} ${r.campaign} ${r.intern} ${r.type}`,
          sort: { brand: r.brand, campaign: r.campaign, intern: r.intern, type: r.type, ...r.metrics, completion: r.completion },
          cells: {
            period: range.label,
            brand: r.brand,
            campaign: r.campaign,
            intern: r.intern,
            type: r.type,
            target: r.metrics.target,
            submitted: r.metrics.submitted,
            client_approved: r.metrics.client_approved,
            published: r.metrics.published,
            verified_live: r.metrics.verified_live,
            awaiting: r.metrics.awaiting,
            completion: r.metrics.target ? (
              <span className="flex min-w-28 items-center gap-2">
                <ToneBadge tone={tone(r.completion)}>{r.completion}%</ToneBadge>
                <ProgressBar value={r.metrics.submitted} max={r.metrics.target} className="flex-1 [&>span]:hidden" />
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">No target</span>
            ),
          },
        }))}
        empty={{ title: "No activity in this period", description: "Try another period or fewer filters." }}
      />
      {rows.length ? (
        <p className="text-right text-xs text-muted-foreground">
          Totals: {UNIFIED_METRICS.map((m) => `${UNIFIED_LABEL[m]} ${totals[m]}`).join(" · ")} · Completion {completion === null ? "—" : `${completion}%`}
        </p>
      ) : null}

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

      <div id="saved" className="scroll-mt-20">
        <h2 className="text-sm font-semibold">Saved Reports</h2>
        <p className="text-xs text-muted-foreground">Frozen snapshots, including scheduled reports. Single-brand snapshots can be published to that brand&apos;s portal.</p>
      </div>
      <DataTable
        cards={{ title: "name", badge: "status", actions: "actions", storageKey: "saved" }}
        searchPlaceholder="Search saved reports…"
        columns={[
          { key: "name", header: "Report Name", sortable: true },
          { key: "type", header: "Report Type", sortable: true },
          { key: "range", header: "Date Range", sortable: true },
          { key: "brand", header: "Brand", sortable: true },
          { key: "created", header: "Created", sortable: true },
          { key: "by", header: "Created By", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "actions", header: "" },
        ]}
        rows={snaps.map((r) => {
          const brand = r.client_id ? (lookups.clients.find((c) => c.id === r.client_id)?.company_name ?? "—") : "All brands"
          const by = r.generated_by ? (authorName[r.generated_by] ?? "—") : r.is_scheduled ? "Scheduled job" : "—"
          return {
            id: r.id,
            href: `/admin/reports/saved/${r.id}`,
            search: `${r.title} ${snapType(r)} ${brand} ${by}`,
            sort: { name: r.title, type: snapType(r), range: r.period_start, brand, created: r.created_at, by, status: r.status },
            cells: {
              name: <Link href={`/admin/reports/saved/${r.id}`} className="font-medium hover:text-primary">{r.title}</Link>,
              type: <span>{snapType(r)}{r.is_scheduled ? <span className="block text-xs text-muted-foreground">Scheduled</span> : null}</span>,
              range: r.period_start === r.period_end ? formatDay(r.period_start) : `${formatDay(r.period_start)} – ${formatDay(r.period_end)}`,
              brand,
              created: formatDateTime(r.created_at, timezone),
              by,
              status: <ToneBadge tone={r.status === "published" ? "success" : "muted"}>{r.status === "published" ? "Published to client" : "Draft"}</ToneBadge>,
              actions: (
                <span className="flex items-center gap-1">
                  <Link href={`/admin/reports/saved/${r.id}`} className="rounded-md px-2 py-1 text-xs hover:bg-muted">View</Link>
                  <SnapshotActions id={r.id} status={r.status} hasClient={Boolean(r.client_id)} />
                </span>
              ),
            },
          }
        })}
        empty={{ title: "No saved reports yet", description: "Use “Save report” to keep a snapshot of the current view." }}
      />
    </>
  )
}
