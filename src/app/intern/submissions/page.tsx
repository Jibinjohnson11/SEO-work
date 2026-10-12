import Link from "next/link"
import { Plus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { SubmissionStatusBadge } from "@/components/shared/status-badge"
import { LinkButton } from "@/components/ui/link-button"
import { formatDateTime, timeAgo } from "@/lib/format"
import { SUBMISSION_STATUS, SUBMISSION_STATUSES } from "@/lib/workflow"
import { getPresets, param, type SearchParams } from "@/server/queries"
import type { Submission, SubmissionStatus } from "@/lib/types"

export const metadata = { title: "My Submissions" }

export default async function InternSubmissions({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase, profile } = await requireRole(["intern"])
  let q = supabase.from("backlink_submissions").select("*, campaigns(code), backlink_types(name)").eq("intern_id", profile.id).order("updated_at", { ascending: false }).limit(2000)
  const status = param(sp, "status")
  if (status === "attention") q = q.in("status", ["draft", "internal_changes_requested", "client_changes_requested", "client_approved", "ready_for_publication"])
  else if (SUBMISSION_STATUSES.includes(status as SubmissionStatus)) q = q.eq("status", status)
  const [{ data }, presets] = await Promise.all([q, getPresets(supabase, "/intern/submissions")])
  const subs = (data ?? []) as (Submission & { campaigns: { code: string }; backlink_types: { name: string } })[]
  return (
    <>
      <PageHeader title="My Submissions" description="Your opportunities and drafts with their approval status and feedback." actions={<LinkButton href="/intern/submissions/new" variant="default"><Plus /> New submission</LinkButton>} />
      <FilterBar presets={presets} filters={[{ type: "select", key: "status", label: "Status", options: [{ value: "attention", label: "Needs my action" }, ...SUBMISSION_STATUSES.map((s) => ({ value: s, label: SUBMISSION_STATUS[s].label }))] }]} />
      <DataTable
        searchPlaceholder="Search code, website, title…"
        columns={[
          { key: "code", header: "Submission", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "type", header: "Type", sortable: true },
          { key: "version", header: "Ver.", align: "right" },
          { key: "submitted", header: "Submitted", sortable: true },
          { key: "updated", header: "Updated", sortable: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={subs.map((s) => ({
          id: s.id,
          search: `${s.code} ${s.proposed_website} ${s.content_title ?? ""} ${s.campaigns.code}`,
          sort: { code: s.code, campaign: s.campaigns.code, type: s.backlink_types.name, submitted: s.first_submitted_at, updated: s.updated_at, status: s.status },
          cells: {
            code: <Link href={`/intern/submissions/${s.id}`} className="group block max-w-72"><span className="font-medium group-hover:text-primary">{s.code}</span><span className="block truncate text-xs text-muted-foreground">{s.content_title ?? s.proposed_domain}</span></Link>,
            campaign: s.campaigns.code,
            type: s.backlink_types.name,
            version: s.current_version || "—",
            submitted: formatDateTime(s.first_submitted_at, profile.timezone),
            updated: timeAgo(s.updated_at),
            status: <SubmissionStatusBadge status={s.status} />,
          },
        }))}
        empty={{ title: "No submissions yet", description: "Create your first submission from a task or campaign." }}
      />
    </>
  )
}
