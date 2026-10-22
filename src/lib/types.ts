// Row shapes for the tables in supabase/migrations. Keep in sync with the schema
// (or replace with `supabase gen types typescript` output once a project is linked).

export type AppRole = "super_admin" | "intern" | "client"
export type UserStatus = "invited" | "active" | "disabled" | "pending" | "rejected"
export type ClientStatus = "active" | "paused" | "archived"
export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "archived"
export type Priority = "low" | "medium" | "high" | "urgent"
export type RecordStatus = "active" | "paused" | "archived"
export type SearchIntent = "informational" | "navigational" | "commercial" | "transactional" | "local"
export type TaskCadence = "one_off" | "daily" | "weekly" | "monthly"
export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "under_review"
  | "changes_requested"
  | "completed"
  | "cancelled"
export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "internal_review"
  | "internal_changes_requested"
  | "internally_approved"
  | "internal_rejected"
  | "awaiting_client_approval"
  | "client_changes_requested"
  | "client_approved"
  | "client_rejected"
  | "ready_for_publication"
  | "published"
  | "verification_pending"
  | "verified_live"
  | "verification_failed"
  | "archived"
export type ReviewDecision = "approved" | "changes_requested" | "rejected"
export type LinkAttribute = "dofollow" | "nofollow" | "sponsored" | "ugc" | "unknown"
export type LiveStatus = "pending_verification" | "live" | "changed" | "missing" | "unreachable"
export type VerificationResult = "live" | "changed" | "missing" | "unreachable" | "inconclusive"
export type OutreachStatus = "not_contacted" | "contacted" | "follow_up" | "negotiating" | "accepted" | "declined"
export type ReportKind = "daily" | "weekly" | "monthly" | "custom"

export interface Profile {
  id: string
  email: string
  full_name: string
  /** Null only while a self-registered account is pending or rejected. */
  role: AppRole | null
  status: UserStatus
  /** Explicit feature keys; null = the role defaults (see src/lib/permissions.ts). */
  permissions: string[] | null
  phone: string | null
  job_title: string | null
  avatar_url: string | null
  timezone: string
  joining_date: string | null
  daily_target: number
  weekly_target: number
  monthly_target: number
  email_notifications: boolean
  last_sign_in_at: string | null
  created_at: string
}

export interface PortalSettings {
  show_campaign_progress: boolean
  show_published_backlinks: boolean
  show_reports: boolean
  allow_report_download: boolean
  show_intern_names: boolean
  show_domain_metrics: boolean
  show_target_counts: boolean
}

export interface Client {
  id: string
  code: string
  company_name: string
  website_url: string | null
  industry: string | null
  contact_person: string | null
  contact_email: string | null
  contact_phone: string | null
  country: string | null
  timezone: string
  start_date: string | null
  status: ClientStatus
  notes: string | null
  is_medical: boolean
  require_internal_review: boolean
  require_client_approval: boolean
  reapproval_on_material_change: boolean
  portal_settings: Partial<PortalSettings>
  logo_path: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface Campaign {
  id: string
  code: string
  name: string
  client_id: string
  description: string | null
  target_url: string | null
  target_location: string | null
  priority: Priority
  start_date: string | null
  end_date: string | null
  daily_target: number
  weekly_target: number
  monthly_target: number
  status: CampaignStatus
  is_medical: boolean | null
  require_internal_review: boolean | null
  require_client_approval: boolean | null
  internal_notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface Keyword {
  id: string
  code: string
  keyword: string
  client_id: string
  search_intent: SearchIntent | null
  target_url: string | null
  priority: Priority
  group_name: string | null
  notes: string | null
  status: RecordStatus
  created_at: string
}

export interface BacklinkType {
  id: string
  name: string
  slug: string
  description: string
  required_fields: string[]
  review_checklist: string[]
  sort_order: number
  is_active: boolean
}

export interface Task {
  id: string
  code: string
  title: string
  intern_id: string
  campaign_id: string
  client_id: string
  keyword_id: string | null
  backlink_type_id: string | null
  cadence: TaskCadence
  target_quantity: number
  start_date: string
  due_date: string | null
  priority: Priority
  status: TaskStatus
  instructions: string | null
  created_at: string
}

export interface Submission {
  id: string
  code: string
  client_id: string
  campaign_id: string
  keyword_id: string | null
  task_id: string | null
  /** Client-approved Off-Page Content this placement publishes (20261023000021). */
  offpage_content_id: string | null
  intern_id: string
  backlink_type_id: string
  proposed_website: string
  proposed_domain: string
  placement_url: string | null
  target_url: string
  anchor_text: string | null
  content_title: string | null
  content_draft: string | null
  notes: string | null
  domain_rating: number | null
  domain_authority: number | null
  estimated_traffic: number | null
  website_relevance: string | null
  outreach_contact: string | null
  outreach_status: OutreachStatus | null
  link_attribute: LinkAttribute | null
  status: SubmissionStatus
  current_version: number
  client_approved_version: number | null
  first_submitted_at: string | null
  last_submitted_at: string | null
  created_at: string
  updated_at: string
}

export interface SubmissionVersion {
  id: string
  submission_id: string
  version: number
  /** Field values at this version; versions written before 20261019000016 hold material fields only. */
  snapshot: Record<string, string | number | null>
  /** NULL for versions written before 20261019000016_submission_versioning.sql. */
  change_type: "initial" | "material" | "minor" | "unchanged" | null
  is_material_change: boolean
  /** Client-approved version this one explicitly relies on (re-approval not required by the campaign). */
  approval_carried_from: number | null
  change_summary: string | null
  created_by: string | null
  created_at: string
}

export interface SubmissionEvent {
  id: number
  submission_id: string
  from_status: SubmissionStatus | null
  to_status: SubmissionStatus
  version: number | null
  actor_id: string | null
  note: string | null
  occurred_at: string
}

export interface InternalReview {
  id: string
  submission_id: string
  version: number
  reviewer_name: string
  decision: ReviewDecision
  comments: string | null
  checklist: Record<string, boolean>
  medical_accuracy_reviewed: boolean | null
  medical_reviewer_name: string | null
  medical_reviewer_qualification: string | null
  claims_verified: boolean | null
  sources_checked: boolean | null
  compliance_notes: string | null
  medical_review_date: string | null
  created_at: string
}

export interface ClientApproval {
  id: string
  submission_id: string
  client_id: string
  version: number
  decided_by: string
  decided_by_name: string
  decision: ReviewDecision
  feedback: string | null
  is_admin_override: boolean
  created_at: string
}

export interface PublishedBacklink {
  id: string
  submission_id: string
  client_id: string
  campaign_id: string
  intern_id: string
  backlink_type_id: string
  published_url: string
  publisher_domain: string
  target_url: string
  anchor_text: string | null
  link_attribute: LinkAttribute
  publication_date: string
  live_status: LiveStatus
  last_checked_at: string | null
  first_verified_live_at: string | null
  created_at: string
}

export interface VerificationCheck {
  id: string
  published_backlink_id: string
  method: "automated" | "manual"
  result: VerificationResult
  http_status: number | null
  final_url: string | null
  link_found: boolean | null
  found_anchor_text: string | null
  found_rel: string[] | null
  detected_attribute: LinkAttribute | null
  robots_allowed: boolean | null
  response_time_ms: number | null
  error: string | null
  notes: string | null
  checked_at: string
}

export interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export interface ActivityLog {
  id: number
  actor_id: string | null
  actor_role: AppRole | null
  action: string
  entity_type: string
  entity_id: string | null
  client_id: string | null
  summary: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface ReportRecord {
  id: string
  kind: ReportKind
  client_id: string | null
  title: string
  period_start: string
  period_end: string
  timezone: string
  filters: Record<string, string>
  data: unknown
  status: "draft" | "published"
  is_scheduled: boolean
  published_at: string | null
  created_at: string
}
