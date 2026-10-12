import type {
  AppRole,
  CampaignStatus,
  LiveStatus,
  SubmissionStatus,
  TaskStatus,
} from "@/lib/types"

// Display metadata and UI affordances for workflow states. The database functions in
// supabase/migrations/*_workflow.sql are the authority; this only decides which buttons to show.

export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "muted"

export const SUBMISSION_STATUS: Record<SubmissionStatus, { label: string; tone: Tone; stage: string }> = {
  draft: { label: "Draft", tone: "muted", stage: "Opportunity" },
  submitted: { label: "Submitted", tone: "info", stage: "Internal review" },
  internal_review: { label: "Internal Review", tone: "info", stage: "Internal review" },
  internal_changes_requested: { label: "Internal Changes Requested", tone: "warning", stage: "Internal review" },
  internally_approved: { label: "Internally Approved", tone: "success", stage: "Internal review" },
  internal_rejected: { label: "Internally Rejected", tone: "danger", stage: "Internal review" },
  awaiting_client_approval: { label: "Awaiting Client Approval", tone: "info", stage: "Client approval" },
  client_changes_requested: { label: "Client Changes Requested", tone: "warning", stage: "Client approval" },
  client_approved: { label: "Client Approved", tone: "success", stage: "Client approval" },
  client_rejected: { label: "Client Rejected", tone: "danger", stage: "Client approval" },
  ready_for_publication: { label: "Ready for Publication", tone: "info", stage: "Publication" },
  published: { label: "Published", tone: "success", stage: "Publication" },
  verification_pending: { label: "Verification Pending", tone: "warning", stage: "Verification" },
  verified_live: { label: "Verified Live", tone: "success", stage: "Verification" },
  verification_failed: { label: "Verification Failed", tone: "danger", stage: "Verification" },
  archived: { label: "Archived", tone: "muted", stage: "Closed" },
}

export const SUBMISSION_STATUSES = Object.keys(SUBMISSION_STATUS) as SubmissionStatus[]

/** Statuses that still need someone to act. Used for "pending" counts. */
export const PENDING_STATUSES: SubmissionStatus[] = [
  "submitted",
  "internal_review",
  "internal_changes_requested",
  "internally_approved",
  "awaiting_client_approval",
  "client_changes_requested",
  "client_approved",
  "ready_for_publication",
  "published",
  "verification_pending",
]

export const INTERN_EDITABLE: SubmissionStatus[] = ["draft", "internal_changes_requested", "client_changes_requested"]
export const REVIEWABLE: SubmissionStatus[] = ["submitted", "internal_review"]
export const PUBLISHABLE: SubmissionStatus[] = ["client_approved", "ready_for_publication"]
export const ADMIN_EDITABLE: SubmissionStatus[] = SUBMISSION_STATUSES.filter(
  (s) => !["published", "verification_pending", "verified_live", "verification_failed", "archived"].includes(s),
)
export const REASSIGNABLE: SubmissionStatus[] = [
  "draft",
  "internal_changes_requested",
  "client_changes_requested",
  "internal_rejected",
  "client_rejected",
]

export type SubmissionAction =
  | "edit"
  | "submit"
  | "start_review"
  | "review"
  | "send_to_client"
  | "mark_ready"
  | "override"
  | "client_decide"
  | "publish"
  | "reassign"
  | "archive"
  | "admin_edit"

export function availableActions(
  role: AppRole,
  status: SubmissionStatus,
  opts: { isOwner?: boolean; requireClientApproval?: boolean; allowOverride?: boolean; canApprove?: boolean } = {},
): SubmissionAction[] {
  const a: SubmissionAction[] = []
  if (role === "intern" && opts.isOwner) {
    if (INTERN_EDITABLE.includes(status)) a.push("edit", "submit")
    if (PUBLISHABLE.includes(status)) a.push("publish")
  }
  if (role === "super_admin") {
    if (status === "submitted") a.push("start_review")
    if (REVIEWABLE.includes(status)) a.push("review")
    if (status === "internally_approved") a.push("send_to_client")
    if (status === "client_approved" || (status === "internally_approved" && opts.requireClientApproval === false))
      a.push("mark_ready")
    if (opts.allowOverride && (status === "awaiting_client_approval" || status === "client_changes_requested"))
      a.push("override")
    if (PUBLISHABLE.includes(status)) a.push("publish")
    if (ADMIN_EDITABLE.includes(status)) a.push("admin_edit")
    if (REASSIGNABLE.includes(status)) a.push("reassign")
    if (status !== "archived") a.push("archive")
  }
  if (role === "client" && opts.canApprove && status === "awaiting_client_approval") a.push("client_decide")
  return a
}

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  not_started: { label: "Not Started", tone: "muted" },
  in_progress: { label: "In Progress", tone: "info" },
  submitted: { label: "Submitted", tone: "info" },
  under_review: { label: "Under Review", tone: "warning" },
  changes_requested: { label: "Changes Requested", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "muted" },
}

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "muted" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "info" },
  archived: { label: "Archived", tone: "muted" },
}

export const LIVE_STATUS: Record<LiveStatus, { label: string; tone: Tone }> = {
  pending_verification: { label: "Pending Verification", tone: "warning" },
  live: { label: "Live", tone: "success" },
  changed: { label: "Changed", tone: "warning" },
  missing: { label: "Missing", tone: "danger" },
  unreachable: { label: "Unreachable", tone: "danger" },
}

export const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" } as const
export const PRIORITY_TONE: Record<keyof typeof PRIORITY_LABEL, Tone> = {
  low: "muted",
  medium: "neutral",
  high: "warning",
  urgent: "danger",
}

export const LINK_ATTRIBUTES = ["dofollow", "nofollow", "sponsored", "ugc", "unknown"] as const
export const OUTREACH_STATUSES = ["not_contacted", "contacted", "follow_up", "negotiating", "accepted", "declined"] as const
export const SEARCH_INTENTS = ["informational", "navigational", "commercial", "transactional", "local"] as const
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const

export function humanize(value: string | null | undefined) {
  if (!value) return "—"
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Fields an intern can mark as required per backlink type (Settings → Backlink types). */
export const CONFIGURABLE_REQUIRED_FIELDS = [
  "placement_url",
  "anchor_text",
  "content_title",
  "content_draft",
  "outreach_contact",
  "website_relevance",
] as const
