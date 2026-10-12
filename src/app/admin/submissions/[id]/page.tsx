import { notFound } from "next/navigation"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { ReviewPanel } from "@/components/submissions/review-panel"
import { AdminActions } from "@/components/submissions/admin-actions"
import { PublicationForm } from "@/components/submissions/publication-form"
import { ManualVerifyButton, VerifyNowButton } from "@/components/submissions/verification-controls"
import { FileList } from "@/components/submissions/file-list"
import { PublicationPanel, StageSummary, SubmissionContent, Timeline, VersionHistory } from "@/components/submissions/submission-view"
import { availableActions } from "@/lib/workflow"
import { todayIn } from "@/lib/reporting"
import { getLookups, getSetting } from "@/server/queries"
import { loadSubmissionDetail } from "@/server/submission-detail"

export default async function AdminSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, profile } = await requireRole(["super_admin"])
  const d = await loadSubmissionDetail(supabase, id)
  if (!d) notFound()
  const [approval, lookups] = await Promise.all([getSetting("approval"), getLookups(supabase)])
  const s = d.submission
  const tz = s.clients.timezone
  const actions = availableActions("super_admin", s.status, { requireClientApproval: d.flags.require_client_approval, allowOverride: approval.allow_admin_override })
  const intern = lookups.interns.find((i) => i.id === s.intern_id)

  return (
    <>
      <PageHeader
        title={`${s.code} · ${s.content_title ?? s.proposed_domain}`}
        description={<span>By {intern?.full_name || intern?.email || "intern"} · <StageSummary d={d} /></span>}
      />
      <AdminActions submission={s} actions={actions} interns={lookups.interns.filter((i) => i.status === "active").map((i) => ({ id: i.id, label: i.full_name || i.email }))} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          {actions.includes("review") ? (
            <Section title="Internal review" description={`Reviewing version ${s.current_version}`} className="border-primary/40">
              <ReviewPanel
                submissionId={s.id}
                typeChecklist={s.backlink_types.review_checklist ?? []}
                isMedical={d.flags.is_medical && approval.medical_review_required}
                medicalChecklist={approval.medical_checklist}
                requireClientApproval={d.flags.require_client_approval}
                reviewerName={profile.full_name}
                today={todayIn(tz)}
              />
            </Section>
          ) : null}
          {actions.includes("publish") ? (
            <Section title="Record publication" className="border-primary/40">
              <PublicationForm submissionId={s.id} anchorText={s.anchor_text} linkAttribute={s.link_attribute} today={todayIn(tz)} />
            </Section>
          ) : null}
          <SubmissionContent d={d} showInternal />
          <PublicationPanel d={d} timeZone={tz} actions={d.published ? <><VerifyNowButton ids={[d.published.id]} /><ManualVerifyButton publishedId={d.published.id} /></> : null} />
          <VersionHistory d={d} timeZone={tz} />
        </div>
        <div className="space-y-6">
          <Section title="Supporting files"><FileList submissionId={s.id} files={d.files} canEdit={false} /></Section>
          <Timeline d={d} timeZone={tz} internal />
        </div>
      </div>
    </>
  )
}
