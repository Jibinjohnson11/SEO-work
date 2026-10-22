import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { ContentArticle, ContentHistory, type ReviewContent } from "@/components/content-approvals/content-reader"
import { ContentReviewForm } from "@/components/portal/content-review-form"
import { portalClients } from "@/server/portal"

export const metadata = { title: "Review Content" }

// The client reads the complete submitted content, then decides below it. The database function
// (client_portal_offpage_content) returns content only for the client's own brands.
export default async function PortalContentReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const { supabase, permissions } = await requireRole(["client"], "portal.approvals")
  const [{ data, error }, clients] = await Promise.all([supabase.rpc("client_portal_offpage_content", { p_id: id }), portalClients(supabase)])
  if (error || !data) notFound()
  const raw = data as Omit<ReviewContent, "brand"> & { can_approve: boolean; client_id: string; brand: string | null }
  const client = clients.find((c) => c.id === raw.client_id)
  const d: ReviewContent = { ...raw, brand: raw.brand ?? client?.company_name ?? "—" }
  const tz = client?.timezone ?? clients[0]?.timezone ?? "UTC"
  const canDecide = raw.can_approve && can(permissions, "portal.approvals.decide")

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Link href="/portal/approvals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" aria-hidden /> Content Approvals
      </Link>

      <ContentArticle content={d} tz={tz} />

      <section aria-labelledby="review-heading" className="surface border-primary/40">
        <header className="border-b px-5 py-4 sm:px-10">
          <h2 id="review-heading" className="text-base font-semibold">Your review</h2>
          <p className="text-sm text-muted-foreground">Read the full content above, then choose a decision.</p>
        </header>
        <div className="px-5 py-5 sm:px-10">
          {d.status === "awaiting_client_approval" && canDecide ? (
            <ContentReviewForm contentId={d.id} version={d.current_version} />
          ) : d.status === "awaiting_client_approval" ? (
            <p className="text-sm text-muted-foreground">You can read this content, but your account is not allowed to approve content for this brand.</p>
          ) : d.status === "changes_requested" ? (
            <p className="text-sm text-muted-foreground">You asked for edits to version {d.current_version}. The SEO team is revising it; you will be notified when the new version is ready to review.</p>
          ) : d.status === "approved" ? (
            <p className="text-sm text-muted-foreground">Version {d.approved_version} was approved. No further action is needed.</p>
          ) : (
            <p className="text-sm text-muted-foreground">This content was rejected and will not be published.</p>
          )}
        </div>
      </section>

      <ContentHistory content={d} tz={tz} />
    </div>
  )
}
