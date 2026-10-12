import { notFound } from "next/navigation"
import { Pencil } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { LinkButton } from "@/components/ui/link-button"
import { FileList } from "@/components/submissions/file-list"
import { PublicationForm } from "@/components/submissions/publication-form"
import { PublicationPanel, StageSummary, SubmissionContent, Timeline, VersionHistory } from "@/components/submissions/submission-view"
import { availableActions } from "@/lib/workflow"
import { todayIn } from "@/lib/reporting"
import { loadSubmissionDetail } from "@/server/submission-detail"

export default async function InternSubmission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, profile } = await requireRole(["intern"])
  const d = await loadSubmissionDetail(supabase, id)
  if (!d || d.submission.intern_id !== profile.id) notFound()
  const s = d.submission
  const tz = profile.timezone || s.clients.timezone
  const actions = availableActions("intern", s.status, { isOwner: true })
  const latestFeedback = [...d.reviews.filter((r) => r.decision !== "approved").map((r) => ({ at: r.created_at, who: `Internal review · ${r.reviewer_name}`, text: r.comments })), ...d.approvals.filter((a) => a.decision !== "approved").map((a) => ({ at: a.created_at, who: `Client · ${a.decided_by_name}`, text: a.feedback }))].sort((a, b) => b.at.localeCompare(a.at))[0]

  return (
    <>
      <PageHeader title={`${s.code} · ${s.content_title ?? s.proposed_domain}`} description={<StageSummary d={d} />} actions={actions.includes("edit") ? <LinkButton href={`/intern/submissions/${s.id}/edit`} variant="default"><Pencil /> {s.status === "draft" ? "Edit & submit" : "Revise & resubmit"}</LinkButton> : null} />
      {actions.includes("edit") && latestFeedback && s.status !== "draft" ? (
        <Section title="Feedback to address" className="border-amber-500/40">
          <p className="text-xs text-muted-foreground">{latestFeedback.who}</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{latestFeedback.text}</p>
        </Section>
      ) : null}
      {actions.includes("publish") ? (
        <Section title="Record publication" className="border-primary/40">
          <PublicationForm submissionId={s.id} anchorText={s.anchor_text} linkAttribute={s.link_attribute} today={todayIn(tz)} />
        </Section>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <SubmissionContent d={d} showInternal />
          <PublicationPanel d={d} timeZone={tz} />
          <VersionHistory d={d} timeZone={tz} />
        </div>
        <div className="space-y-6">
          <Section title="Supporting files"><FileList submissionId={s.id} files={d.files} canEdit={actions.includes("edit")} /></Section>
          <Timeline d={d} timeZone={tz} internal />
        </div>
      </div>
    </>
  )
}
