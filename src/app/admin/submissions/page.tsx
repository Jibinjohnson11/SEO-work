import { Download } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { getLookups, getPresets, getSetting, type SearchParams } from "@/server/queries"
import { querySubmissions, SUBMISSION_COLUMNS, submissionFilters, submissionRows } from "@/server/submission-list"

export const metadata = { title: "Backlink Submissions" }

export default async function SubmissionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports, presets] = await Promise.all([getLookups(supabase), getSetting("reports"), getPresets(supabase, "/admin/submissions")])
  const subs = await querySubmissions(supabase, sp, { timeZone: reports.timezone, limit: 2000 })
  const exportQuery = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()
  return (
    <>
      <PageHeader
        title="Backlink Submissions"
        description="Every opportunity and content draft submitted by team members, across all stages."
        actions={
          <a href={`/api/submissions/export?${exportQuery}`} className="inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[0.8rem] font-medium hover:bg-muted">
            <Download className="size-3.5" /> Export CSV
          </a>
        }
      />
      <FilterBar filters={submissionFilters(lookups)} presets={presets} />
      <DataTable cards={{ title: "code", badge: "status" }} searchPlaceholder="Filter these results…" columns={SUBMISSION_COLUMNS} rows={submissionRows(subs, lookups, reports.timezone)} empty={{ title: "No submissions", description: "Team members' submissions appear here as soon as they are submitted." }} />
      {subs.length >= 2000 ? <p className="text-xs text-muted-foreground">Showing the 2,000 most recently updated. Narrow the filters to see older records.</p> : null}
    </>
  )
}
