import { z } from "zod"
import { isHttpUrl } from "@/lib/url"
import { CONTENT_TYPES, type ContentType } from "@/lib/offpage-content"
import { richTextToPlain } from "@/lib/rich-text"

// Shared by client forms (React Hook Form) and server actions. Forms send empty strings for
// blank optional fields; server actions convert them to null with blankToNull().

const text = (max: number) => z.string().trim().max(max)
const optionalUrl = z
  .string()
  .trim()
  .refine((v) => v === "" || isHttpUrl(v), "Enter a full URL starting with http:// or https://")
const requiredUrl = z.string().trim().refine(isHttpUrl, "Enter a full URL starting with http:// or https://")
const optionalDate = z.string().trim().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date")
const uuid = z.string().uuid("Select a value")
const optionalUuid = z.string().refine((v) => v === "" || z.string().uuid().safeParse(v).success, "Invalid selection")
const count = z.coerce.number().int("Whole numbers only").min(0, "Cannot be negative").max(100000)
export const priority = z.enum(["low", "medium", "high", "urgent"])
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
    return true
  } catch {
    return false
  }
}, "Unknown time zone")

export function blankToNull<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: T[K] | null } {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) out[k] = v === "" ? null : v
  return out as { [K in keyof T]: T[K] | null }
}

export const clientSchema = z.object({
  company_name: text(200).min(1, "Company name is required"),
  website_url: optionalUrl,
  industry: text(120),
  contact_person: text(120),
  contact_email: z.union([z.literal(""), z.email("Invalid email")]),
  contact_phone: text(40),
  country: text(80),
  timezone,
  start_date: optionalDate,
  status: z.enum(["active", "paused", "archived"]),
  notes: text(5000),
  is_medical: z.boolean(),
  require_client_approval: z.boolean(),
  reapproval_on_material_change: z.boolean(),
})
export type ClientInput = z.infer<typeof clientSchema>

export const portalSettingsSchema = z.object({
  show_campaign_progress: z.boolean(),
  show_published_backlinks: z.boolean(),
  show_reports: z.boolean(),
  allow_report_download: z.boolean(),
  show_intern_names: z.boolean(),
  show_domain_metrics: z.boolean(),
  show_target_counts: z.boolean(),
})

const tristate = z.enum(["inherit", "yes", "no"])
export const campaignSchema = z
  .object({
    name: text(200).min(1, "Campaign name is required"),
    client_id: uuid,
    description: text(5000),
    target_url: optionalUrl,
    target_location: text(120),
    priority,
    start_date: optionalDate,
    end_date: optionalDate,
    daily_target: count,
    weekly_target: count,
    monthly_target: count,
    status: z.enum(["draft", "active", "paused", "completed", "archived"]),
    is_medical: tristate,
    require_client_approval: tristate,
    internal_notes: text(5000),
    // Keywords are managed by name in the campaign forms; the server reuses or creates keyword records.
    primary_keyword: text(200),
    secondary_keywords: z.array(text(200).min(1)).max(50, "Add at most 50 secondary keywords"),
    intern_ids: z.array(uuid),
    backlink_type_ids: z.array(uuid),
  })
  .refine((v) => !v.start_date || !v.end_date || v.end_date >= v.start_date, {
    message: "End date must be on or after the start date",
    path: ["end_date"],
  })
export type CampaignInput = z.infer<typeof campaignSchema>

/**
 * Simplified "New campaign" form. The name, start date, status and weekly/monthly targets are derived
 * on the server; approval settings are left to inherit from the brand.
 */
export const newCampaignSchema = z.object({
  client_id: uuid,
  primary_keyword: text(200).min(1, "Primary keyword is required"),
  secondary_keywords: z.array(text(200).min(1)).max(50, "Add at most 50 secondary keywords"),
  target_url: optionalUrl,
  /** The form's Active field: Yes = active, No = draft. */
  status: z.enum(["active", "draft"]),
  backlink_type_ids: z.array(uuid),
  priority,
  description: text(5000),
  internal_notes: text(5000),
})
export type NewCampaignInput = z.infer<typeof newCampaignSchema>

export function tristateToDb(v: "inherit" | "yes" | "no") {
  return v === "inherit" ? null : v === "yes"
}
export function dbToTristate(v: boolean | null): "inherit" | "yes" | "no" {
  return v === null ? "inherit" : v ? "yes" : "no"
}

/** The keyword fields edited on a campaign page; keyword names are managed on the campaign forms. */
export const keywordDetailsSchema = z.object({
  target_url: optionalUrl,
  search_intent: z.union([z.literal(""), z.enum(["informational", "navigational", "commercial", "transactional", "local"])]),
})
export type KeywordDetailsInput = z.infer<typeof keywordDetailsSchema>

export const taskSchema = z
  .object({
    client_id: z.string().uuid("Select a brand"),
    campaign_id: z.string().uuid("Select a campaign"),
    keyword_id: z.string().uuid("Select a keyword"),
    intern_ids: z.array(uuid).min(1, "Choose at least one team member").max(200),
    backlink_type_id: optionalUuid,
    // each: every member gets the full quantity; shared: the quantity is split between them.
    target_mode: z.enum(["each", "shared"]),
    target_quantity: z.coerce.number().int("Whole numbers only").min(1, "Target must be at least 1").max(1000),
    cadence: z.enum(["daily", "weekly", "one_off"]),
    due_date: optionalDate,
    instructions: text(5000),
  })
  .refine((v) => v.target_mode === "each" || v.target_quantity >= v.intern_ids.length, {
    message: "A shared target needs at least 1 backlink per member",
    path: ["target_quantity"],
  })
export type TaskInput = z.infer<typeof taskSchema>

export const taskUpdateSchema = z.object({
  title: text(200).min(1, "Title is required"),
  intern_id: uuid,
  keyword_id: optionalUuid,
  backlink_type_id: optionalUuid,
  cadence: z.enum(["one_off", "daily", "weekly", "monthly"]),
  target_quantity: z.coerce.number().int().min(1).max(1000),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: optionalDate,
  priority,
  status: z.enum(["not_started", "in_progress", "submitted", "under_review", "changes_requested", "completed", "cancelled"]),
  instructions: text(5000),
})
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>

export const backlinkTypeSchema = z.object({
  name: text(80).min(1, "Name is required"),
  description: text(1000),
  required_fields: z.array(z.string()),
  review_checklist: z.array(text(300).min(1)),
  sort_order: z.coerce.number().int().min(0).max(10000),
  is_active: z.boolean(),
  campaign_ids: z.array(uuid),
})
export type BacklinkTypeInput = z.infer<typeof backlinkTypeSchema>

export const inviteUserSchema = z.object({
  email: z.email("Enter a valid email"),
  full_name: text(120).min(1, "Name is required"),
  role: z.enum(["intern", "client"]),
  job_title: text(120),
  joining_date: optionalDate,
  daily_target: count,
  weekly_target: count,
  monthly_target: count,
  client_id: optionalUuid,
  campaign_ids: z.array(uuid),
  can_approve: z.boolean(),
  can_download_reports: z.boolean(),
})
export type InviteUserInput = z.infer<typeof inviteUserSchema>

export const internUpdateSchema = z.object({
  full_name: text(120).min(1, "Name is required"),
  job_title: text(120),
  joining_date: optionalDate,
  daily_target: count,
  weekly_target: count,
  monthly_target: count,
  status: z.enum(["invited", "active", "disabled"]),
  campaign_ids: z.array(uuid),
})
export type InternUpdateInput = z.infer<typeof internUpdateSchema>

// Access control: features are validated against the catalog for the role on the server.
const featureKeys = z.array(z.string().max(80)).max(50)

export const approveUserSchema = z
  .object({
    role: z.enum(["intern", "client"]),
    use_role_defaults: z.boolean(),
    features: featureKeys,
    client_id: optionalUuid,
    can_approve: z.boolean(),
    can_download_reports: z.boolean(),
    campaign_ids: z.array(uuid),
  })
  .refine((v) => v.role !== "client" || v.client_id !== "", { message: "Choose the client workspace for this user", path: ["client_id"] })
export type ApproveUserInput = z.infer<typeof approveUserSchema>

export const userAccessSchema = z.object({ use_role_defaults: z.boolean(), features: featureKeys })
export type UserAccessInput = z.infer<typeof userAccessSchema>

export const submissionSchema = z.object({
  campaign_id: uuid,
  backlink_type_id: uuid,
  keyword_id: optionalUuid,
  task_id: optionalUuid,
  /** Client-approved Off-Page Content this placement publishes; the placement then skips client approval. */
  offpage_content_id: optionalUuid,
  proposed_website: text(500).min(1, "Proposed website is required"),
  placement_url: optionalUrl,
  target_url: requiredUrl,
  anchor_text: text(300),
  content_title: text(300),
  content_draft: z.string().max(100_000),
  notes: text(5000),
  domain_rating: z.union([z.literal(""), z.coerce.number().min(0).max(100)]),
  domain_authority: z.union([z.literal(""), z.coerce.number().min(0).max(100)]),
  estimated_traffic: z.union([z.literal(""), z.coerce.number().int().min(0)]),
  website_relevance: text(500),
  outreach_contact: text(300),
  outreach_status: z.union([
    z.literal(""),
    z.enum(["not_contacted", "contacted", "follow_up", "negotiating", "accepted", "declined"]),
  ]),
  link_attribute: z.union([z.literal(""), z.enum(["dofollow", "nofollow", "sponsored", "ugc", "unknown"])]),
  change_summary: text(500),
})
export type SubmissionInput = z.infer<typeof submissionSchema>

/** Super Admin edit of a submission's content (also used by the edit form in the browser). */
export const adminEditSchema = submissionSchema
  .pick({ proposed_website: true, placement_url: true, target_url: true, anchor_text: true, content_title: true, content_draft: true, notes: true, link_attribute: true })
  .extend({ change_summary: z.string().trim().max(500) })
export type AdminEditInput = z.infer<typeof adminEditSchema>

export const internalReviewSchema = z
  .object({
    decision: z.enum(["approved", "changes_requested", "rejected"]),
    comments: text(5000),
    checklist: z.record(z.string(), z.boolean()),
    forward_to_client: z.boolean(),
    medical: z
      .object({
        medical_accuracy_reviewed: z.boolean(),
        medical_reviewer_name: text(120),
        medical_reviewer_qualification: text(120),
        claims_verified: z.boolean(),
        sources_checked: z.boolean(),
        compliance_notes: text(2000),
        medical_review_date: optionalDate,
      })
      .nullable(),
  })
  .refine((v) => v.decision === "approved" || v.comments.length > 0, {
    message: "Explain what needs to change",
    path: ["comments"],
  })
export type InternalReviewInput = z.infer<typeof internalReviewSchema>

export const clientDecisionSchema = z
  .object({
    decision: z.enum(["approved", "changes_requested", "rejected"]),
    feedback: text(5000),
    version: z.number().int().min(1),
  })
  .refine((v) => v.decision === "approved" || v.feedback.length > 0, {
    message: "Please add feedback explaining your decision",
    path: ["feedback"],
  })

export const publicationSchema = z.object({
  published_url: requiredUrl,
  publication_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Publication date is required"),
  link_attribute: z.enum(["dofollow", "nofollow", "sponsored", "ugc", "unknown"]),
  anchor_text: text(300),
})

export const manualVerificationSchema = z.object({
  result: z.enum(["live", "changed", "missing", "unreachable"]),
  notes: text(2000).min(5, "Describe the evidence (at least 5 characters)"),
})

export const generalSettingsSchema = z.object({
  platform_name: text(60).min(1),
  logo_url: optionalUrl,
  default_timezone: timezone,
  date_format: z.enum(["dd MMM yyyy", "MMM d, yyyy", "yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"]),
  theme: z.enum(["system", "light", "dark"]),
})

export const campaignDefaultsSchema = z.object({
  daily_target: count,
  weekly_target: count,
  monthly_target: count,
  priority,
  working_days_per_week: z.coerce.number().int("Whole numbers only").min(1, "At least 1 day").max(7, "At most 7 days"),
})

export const approvalSettingsSchema = z.object({
  client_approval_required: z.boolean(),
  reapproval_on_material_change: z.boolean(),
  allow_admin_override: z.boolean(),
  medical_review_required: z.boolean(),
  medical_checklist: z.array(text(300).min(1)),
  notify_admins_on_submission: z.boolean(),
  notify_client_on_forward: z.boolean(),
})

export const verificationSettingsSchema = z.object({
  auto_verify: z.boolean(),
  recheck_interval_hours: z.coerce.number().int().min(1).max(24 * 60),
  timeout_ms: z.coerce.number().int().min(2000).max(30000),
  max_per_run: z.coerce.number().int().min(1).max(200),
  per_domain_delay_ms: z.coerce.number().int().min(0).max(60000),
  respect_robots: z.boolean(),
  max_redirects: z.coerce.number().int().min(0).max(10),
  max_bytes: z.coerce.number().int().min(100_000).max(10_000_000),
})

export const reportSettingsSchema = z.object({
  schedule: z.enum(["off", "daily", "weekly", "monthly"]),
  recipients: z.array(z.email("Invalid recipient email")),
  format: z.enum(["xlsx", "csv", "pdf"]),
  timezone,
})

export const notificationSettingsSchema = z.object({
  email_enabled: z.boolean(),
  deadline_warning_days: z.coerce.number().int().min(0).max(30),
})

export const securitySettingsSchema = z.object({
  idle_timeout_minutes: z.coerce.number().int().min(0).max(24 * 60),
  log_sign_ins: z.boolean(),
})

export const SETTINGS_SCHEMAS = {
  general: generalSettingsSchema,
  campaign_defaults: campaignDefaultsSchema,
  approval: approvalSettingsSchema,
  verification: verificationSettingsSchema,
  reports: reportSettingsSchema,
  notifications: notificationSettingsSchema,
  security: securitySettingsSchema,
} as const
export type SettingsKey = keyof typeof SETTINGS_SCHEMAS

export const offpageContentSchema = z.object({
  campaign_id: z.string().uuid("Select a campaign"),
  keyword_id: z.string().uuid("Select a target keyword"),
  backlink_type_id: z.string().uuid("Select a backlink type"),
  content_type: z.enum(Object.keys(CONTENT_TYPES) as [ContentType, ...ContentType[]], "Select a content type"),
  title: text(200).min(1, "Content title is required"),
  content_html: z
    .string()
    .max(200000, "Content is too long")
    .refine((v) => richTextToPlain(v).length > 0, "Write or paste the content"),
})
export type OffpageContentInput = z.infer<typeof offpageContentSchema>

