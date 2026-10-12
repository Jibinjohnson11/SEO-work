import { notFound, redirect } from "next/navigation"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { SubmissionForm } from "@/components/intern/submission-form"
import { INTERN_EDITABLE } from "@/lib/workflow"
import { getInternFormOptions } from "@/server/intern-options"
import type { Submission } from "@/lib/types"

export default async function EditSubmission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, profile } = await requireRole(["intern"])
  const { data } = await supabase.from("backlink_submissions").select("*").eq("id", id).eq("intern_id", profile.id).maybeSingle()
  if (!data) notFound()
  const s = data as Submission
  if (!INTERN_EDITABLE.includes(s.status)) redirect(`/intern/submissions/${id}`)
  const options = await getInternFormOptions(supabase, profile.id)
  return (
    <>
      <PageHeader title={`Edit ${s.code}`} description={s.status === "draft" ? "Draft" : "Address the feedback, then resubmit. Your previous version is kept in the history."} />
      <SubmissionForm options={options} submission={s} />
    </>
  )
}
