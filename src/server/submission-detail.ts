import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  ClientApproval,
  InternalReview,
  PublishedBacklink,
  Submission,
  SubmissionEvent,
  SubmissionVersion,
  VerificationCheck,
} from "@/lib/types"

/** Everything shown on a submission page. RLS limits interns to their own submission. */
export async function loadSubmissionDetail(supabase: SupabaseClient, id: string) {
  const { data } = await supabase
    .from("backlink_submissions")
    .select("*, campaigns(id, code, name, target_url), clients(id, company_name, timezone), backlink_types(id, name, review_checklist, required_fields), keywords(keyword), tasks(code, title)")
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  const [versions, events, reviews, approvals, files, published, flags] = await Promise.all([
    supabase.from("submission_versions").select("*").eq("submission_id", id).order("version", { ascending: false }),
    supabase.from("submission_events").select("*").eq("submission_id", id).order("occurred_at", { ascending: true }),
    supabase.from("internal_reviews").select("*").eq("submission_id", id).order("created_at", { ascending: false }),
    supabase.from("client_approvals").select("*").eq("submission_id", id).order("created_at", { ascending: false }),
    supabase.from("submission_files").select("id, file_name, size_bytes, created_at").eq("submission_id", id).order("created_at"),
    supabase.from("published_backlinks").select("*").eq("submission_id", id).maybeSingle(),
    supabase.rpc("campaign_flags", { p_campaign_id: (data as Submission).campaign_id }).single(),
  ])
  const pub = published.data as PublishedBacklink | null
  const checks = pub
    ? ((await supabase.from("verification_checks").select("*").eq("published_backlink_id", pub.id).order("checked_at", { ascending: false }).limit(20)).data ?? [])
    : []
  return {
    submission: data as Submission & {
      campaigns: { id: string; code: string; name: string; target_url: string | null }
      clients: { id: string; company_name: string; timezone: string }
      backlink_types: { id: string; name: string; review_checklist: string[]; required_fields: string[] }
      keywords: { keyword: string } | null
      tasks: { code: string; title: string } | null
    },
    versions: (versions.data ?? []) as SubmissionVersion[],
    events: (events.data ?? []) as SubmissionEvent[],
    reviews: (reviews.data ?? []) as InternalReview[],
    approvals: (approvals.data ?? []) as ClientApproval[],
    files: (files.data ?? []) as { id: string; file_name: string; size_bytes: number | null; created_at: string }[],
    published: pub,
    checks: checks as VerificationCheck[],
    flags: (flags.data ?? { is_medical: false, require_internal_review: true, require_client_approval: true, reapproval_on_material_change: true }) as {
      is_medical: boolean
      require_internal_review: boolean
      require_client_approval: boolean
      reapproval_on_material_change: boolean
    },
  }
}
export type SubmissionDetail = NonNullable<Awaited<ReturnType<typeof loadSubmissionDetail>>>
