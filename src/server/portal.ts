import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { LinkAttribute, LiveStatus, PortalSettings, ReviewDecision, SubmissionStatus } from "@/lib/types"

export interface PortalClient {
  id: string
  code: string
  company_name: string
  website_url: string | null
  timezone: string
  settings: PortalSettings
  can_approve: boolean
  can_download_reports: boolean
}
export interface PortalSubmission {
  id: string
  code: string
  client_id: string
  campaign_code: string
  campaign_name: string
  keyword: string | null
  backlink_type: string
  proposed_website: string
  placement_url: string | null
  target_url: string
  anchor_text: string | null
  content_title: string | null
  status: SubmissionStatus
  current_version: number
  client_approved_version: number | null
  submitted_at: string | null
  sent_to_client_at: string | null
  last_decision: ReviewDecision | null
  last_decision_at: string | null
  domain_rating: number | null
  domain_authority: number | null
  intern_name: string | null
}
export interface PortalCampaign {
  id: string
  code: string
  name: string
  client_id: string
  client_name: string
  status: "active" | "paused" | "completed"
  priority: "low" | "medium" | "high" | "urgent"
  start_date: string | null
  end_date: string | null
  target_url: string | null
  monthly_target: number | null
  primary_keyword: string | null
  keywords: string[]
  month_submitted: number | null
  month_client_approved: number | null
  month_published: number | null
  month_verified: number | null
  awaiting_approval: number
  total_published: number | null
  total_verified: number | null
}
export interface PortalPublished {
  id: string
  submission_code: string
  campaign_code: string
  campaign_name: string
  backlink_type: string
  published_url: string
  publisher_domain: string
  target_url: string
  anchor_text: string | null
  link_attribute: LinkAttribute
  publication_date: string
  live_status: LiveStatus
  last_checked_at: string | null
}

// Client users only reach data through the client_portal_* database functions, which return
// client-safe columns for their own workspace(s) and apply the portal visibility settings.
export async function portalClients(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("client_portal_clients")
  if (error) throw error
  return (data ?? []) as PortalClient[]
}
export async function portalSubmissions(supabase: SupabaseClient, queueOnly = false) {
  const { data, error } = await supabase.rpc("client_portal_submissions", { p_queue_only: queueOnly })
  if (error) throw error
  return (data ?? []) as PortalSubmission[]
}
export async function portalCampaigns(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("client_portal_campaigns")
  if (error) throw error
  return (data ?? []) as PortalCampaign[]
}
export async function portalPublished(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("client_portal_published")
  if (error) throw error
  return (data ?? []) as PortalPublished[]
}
