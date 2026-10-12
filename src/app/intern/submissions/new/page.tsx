import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { SubmissionForm } from "@/components/intern/submission-form"
import { param, type SearchParams } from "@/server/queries"
import { getInternFormOptions } from "@/server/intern-options"

export const metadata = { title: "New Submission" }

export default async function NewSubmission({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase, profile } = await requireRole(["intern"])
  const options = await getInternFormOptions(supabase, profile.id)
  return (
    <>
      <PageHeader title="New submission" description="Save a draft any time. Submitting sends it to internal review; nothing reaches the client until it is approved." />
      {options.campaigns.length === 0 ? (
        <EmptyState title="No active campaigns" description="You can submit once you are assigned to an active campaign." />
      ) : (
        <SubmissionForm options={options} preset={{ campaign_id: param(sp, "campaign"), task_id: param(sp, "task") }} />
      )}
    </>
  )
}
