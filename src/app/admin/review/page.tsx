import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { StatCard } from "@/components/shared/stat-card"
import { getLookups, getPresets, getSetting, type SearchParams } from "@/server/queries"
import { querySubmissions, SUBMISSION_COLUMNS, submissionFilters, submissionRows } from "@/server/submission-list"

export const metadata = { title: "Medical Review" }

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports, presets] = await Promise.all([getLookups(supabase), getSetting("reports"), getPresets(supabase, "/admin/review")])
  const statuses = ["submitted", "internal_review", "internally_approved"] as const
  const subs = await querySubmissions(supabase, sp, { statuses: [...statuses], timeZone: reports.timezone })
  const subsOldestFirst = [...subs].sort((a, b) => (a.last_submitted_at ?? "").localeCompare(b.last_submitted_at ?? ""))
  const count = (s: string) => subs.filter((x) => x.status === s).length
  return (
    <>
      <PageHeader title="Medical Review" description="Internal review applies to medical brands and campaigns only: confirm the medical checklist before anything reaches the client. Oldest first." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="New submissions" value={count("submitted")} tone={count("submitted") ? "warning" : "default"} />
        <StatCard label="In review" value={count("internal_review")} />
        <StatCard label="Approved, not yet sent to client" value={count("internally_approved")} />
      </div>
      <FilterBar filters={submissionFilters(lookups, { statuses: [...statuses] })} presets={presets} />
      <DataTable cards={{ title: "code", badge: "status" }} searchPlaceholder={false} columns={SUBMISSION_COLUMNS} rows={submissionRows(subsOldestFirst, lookups, reports.timezone)} empty={{ title: "Review queue is empty", description: "Nothing is waiting for medical review." }} />
    </>
  )
}
