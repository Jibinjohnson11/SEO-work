import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { ContentArticle, ContentHistory, type ReviewContent } from "@/components/content-approvals/content-reader"
import { ContentReviewForm } from "@/components/portal/content-review-form"
import { LinkButton } from "@/components/ui/link-button"
import type { ContentDecision, ContentVersion, OffpageContent } from "@/lib/offpage-content"
import { getLookups, getSetting, labelMaps } from "@/server/queries"

export const metadata = { title: "Content Review" }

// What the client reviews, with every decision and version. Decisions are made by the client; a Super
// Admin may record an audited override when Approval Settings allow it. Edits and resubmissions happen in
// Off-Page Content.
export default async function AdminContentReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const { supabase } = await requireRole(["super_admin"])
  const [{ data }, versionRes, decisionRes, lookups, reports, approval] = await Promise.all([
    supabase.from("offpage_contents").select("*").eq("id", id).maybeSingle(),
    supabase.from("offpage_content_versions").select("content_id, version, title, content_html, created_at").eq("content_id", id).order("version", { ascending: false }),
    supabase.from("offpage_content_decisions").select("content_id, version, decision, feedback, decided_by_name, created_at, is_admin_override").eq("content_id", id).order("created_at", { ascending: false }),
    getLookups(supabase),
    getSetting("reports"),
    getSetting("approval"),
  ])
  if (!data) notFound()
  const c = data as OffpageContent
  const labels = labelMaps(lookups)
  const campaign = lookups.campaigns.find((x) => x.id === c.campaign_id)
  const d: ReviewContent = {
    ...c,
    brand: labels.client[c.client_id] ?? "—",
    campaign: { code: campaign?.code ?? "—", name: campaign?.name ?? "Unknown campaign" },
    keyword: labels.keyword[c.keyword_id] ?? "—",
    backlink_type: labels.backlink_type[c.backlink_type_id] ?? "—",
    versions: (versionRes.data ?? []) as ContentVersion[],
    decisions: (decisionRes.data ?? []) as ContentDecision[],
  }
  const tz = reports.timezone

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/approvals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="size-4" aria-hidden /> Content Approvals
        </Link>
        <LinkButton href={`/admin/page-content?q=${c.code}`} variant="outline">Open in Off-Page Content</LinkButton>
      </div>
      <ContentArticle content={d} tz={tz} />
      {c.status === "awaiting_client_approval" && approval.allow_admin_override ? (
        <section aria-labelledby="override-heading" className="surface border-warning/40">
          <header className="border-b px-5 py-4 sm:px-10">
            <h2 id="override-heading" className="text-base font-semibold">Admin override</h2>
            <p className="text-sm text-muted-foreground">Only when the client cannot decide. Logged as an override, with your reason.</p>
          </header>
          <div className="px-5 py-5 sm:px-10">
            <ContentReviewForm contentId={c.id} version={c.current_version} override />
          </div>
        </section>
      ) : null}
      <ContentHistory content={d} tz={tz} />
    </div>
  )
}
