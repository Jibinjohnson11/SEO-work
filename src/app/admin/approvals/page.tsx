import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { StatCard } from "@/components/shared/stat-card"
import { ToneBadge } from "@/components/shared/status-badge"
import { formatDateTime } from "@/lib/format"
import { humanize } from "@/lib/workflow"
import { getLookups, getPresets, getSetting, labelMaps, param, type SearchParams } from "@/server/queries"
import { querySubmissions, SUBMISSION_COLUMNS, submissionFilters, submissionRows } from "@/server/submission-list"
import type { ClientApproval } from "@/lib/types"

export const metadata = { title: "Client Approvals" }

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports, presets] = await Promise.all([getLookups(supabase), getSetting("reports"), getPresets(supabase, "/admin/approvals")])
  const statuses = ["awaiting_client_approval", "client_changes_requested", "client_approved", "client_rejected"] as const
  const subs = await querySubmissions(supabase, sp, { statuses: [...statuses], timeZone: reports.timezone })
  let dq = supabase.from("client_approvals").select("*, backlink_submissions(code, campaign_id)").order("created_at", { ascending: false }).limit(300)
  if (/^[0-9a-f-]{36}$/.test(param(sp, "client"))) dq = dq.eq("client_id", param(sp, "client"))
  const { data: decisions } = await dq
  const labels = labelMaps(lookups)
  const count = (s: string) => subs.filter((x) => x.status === s).length
  const tz = reports.timezone
  return (
    <>
      <PageHeader title="Client Approvals" description="What clients have been asked to approve and every decision they made. Admin overrides are listed separately and never shown as client approvals." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Awaiting client" value={count("awaiting_client_approval")} />
        <StatCard label="Changes requested" value={count("client_changes_requested")} tone={count("client_changes_requested") ? "warning" : "default"} />
        <StatCard label="Approved (awaiting publication)" value={count("client_approved")} tone="success" />
        <StatCard label="Rejected" value={count("client_rejected")} tone={count("client_rejected") ? "danger" : "default"} />
      </div>
      <FilterBar filters={submissionFilters(lookups, { statuses: [...statuses], withPeriod: false })} presets={presets} />
      <DataTable searchPlaceholder={false} columns={SUBMISSION_COLUMNS} rows={submissionRows(subs, lookups, tz)} empty={{ title: "Nothing with clients right now" }} />
      <Section title="Decision log" description="Most recent 300 client decisions and admin overrides" bodyClassName="p-0">
        <DataTable
          searchPlaceholder="Search decisions…"
          pageSize={15}
          columns={[
            { key: "when", header: "When", sortable: true },
            { key: "submission", header: "Submission", sortable: true },
            { key: "client", header: "Client", sortable: true },
            { key: "by", header: "Decided by", sortable: true },
            { key: "decision", header: "Decision", sortable: true },
            { key: "version", header: "Version", align: "right" },
            { key: "feedback", header: "Feedback" },
          ]}
          rows={((decisions ?? []) as (ClientApproval & { backlink_submissions: { code: string; campaign_id: string } })[]).map((a) => ({
            id: a.id,
            search: `${a.backlink_submissions.code} ${a.decided_by_name} ${a.feedback ?? ""} ${labels.client[a.client_id] ?? ""}`,
            sort: { when: a.created_at, submission: a.backlink_submissions.code, client: labels.client[a.client_id], by: a.decided_by_name, decision: a.decision },
            cells: {
              when: formatDateTime(a.created_at, tz),
              submission: <Link href={`/admin/submissions/${a.submission_id}`} className="font-medium hover:text-primary">{a.backlink_submissions.code}</Link>,
              client: labels.client[a.client_id],
              by: a.decided_by_name,
              decision: a.is_admin_override ? <ToneBadge tone="warning">Admin override</ToneBadge> : <ToneBadge tone={a.decision === "approved" ? "success" : a.decision === "rejected" ? "danger" : "warning"}>{humanize(a.decision)}</ToneBadge>,
              version: `v${a.version}`,
              feedback: <span className="line-clamp-2 max-w-80 text-xs">{a.feedback}</span>,
            },
          }))}
          empty={{ title: "No client decisions yet" }}
        />
      </Section>
    </>
  )
}
