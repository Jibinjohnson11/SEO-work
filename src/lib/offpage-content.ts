import type { Tone } from "@/lib/workflow"

// Kept in sync with the checks in supabase/migrations/20261021000019_offpage_content.sql.

export const CONTENT_TYPES = {
  blog: "Blog",
  article: "Article",
  description: "Description",
  social_bookmarking: "Social Bookmarking Content",
  business_listing: "Business Listing Content",
} as const
export type ContentType = keyof typeof CONTENT_TYPES

// Client approval is the only approval stage. Approved and rejected are final. Labels follow the
// Content Approvals wording; "changes_requested" is shown as "Needs Edit".
export const CONTENT_STATUS = {
  awaiting_client_approval: { label: "Pending Review", tone: "info" },
  changes_requested: { label: "Needs Edit", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>
export type ContentStatus = keyof typeof CONTENT_STATUS

/** Statuses in which the author (or a Super Admin) may edit and resubmit content as a new version. */
export const CONTENT_EDITABLE: ContentStatus[] = ["awaiting_client_approval", "changes_requested"]

export const DECISION_LABEL = { approved: "Approved", changes_requested: "Needs Edit", rejected: "Rejected" } as const
export const DECISION_TONE = { approved: "success", changes_requested: "warning", rejected: "danger" } as const satisfies Record<keyof typeof DECISION_LABEL, Tone>

export interface ContentVersion {
  content_id: string
  version: number
  title: string
  content_html: string
  created_at: string
}

export interface ContentDecision {
  content_id: string
  version: number
  decision: keyof typeof DECISION_LABEL
  feedback: string | null
  decided_by_name: string
  created_at: string
  /** Recorded by a Super Admin on the client's behalf (20261023000021). */
  is_admin_override?: boolean
}

export interface OffpageContent {
  id: string
  code: string
  client_id: string
  campaign_id: string
  keyword_id: string
  backlink_type_id: string
  title: string
  content_type: ContentType
  content_html: string
  status: ContentStatus
  current_version: number
  approved_version: number | null
  submitted_by: string
  submitted_at: string
  created_at: string
  updated_at: string
}
