import "server-only"
import { cache } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { presetRange, todayIn, type PeriodPreset } from "@/lib/reporting"
import type { SettingsKey } from "@/lib/validation"

export const SETTINGS_DEFAULTS = {
  general: { platform_name: "LinkOps", logo_url: "", default_timezone: "Asia/Kolkata", date_format: "dd MMM yyyy", theme: "system" },
  campaign_defaults: { daily_target: 5, weekly_target: 25, monthly_target: 100, priority: "medium", working_days_per_week: 5 },
  approval: {
    client_approval_required: true,
    reapproval_on_material_change: true,
    allow_admin_override: false,
    medical_review_required: true,
    medical_checklist: [] as string[],
    notify_admins_on_submission: true,
    notify_client_on_forward: true,
  },
  verification: {
    auto_verify: true,
    recheck_interval_hours: 72,
    timeout_ms: 10000,
    max_per_run: 25,
    per_domain_delay_ms: 2000,
    respect_robots: true,
    max_redirects: 5,
    max_bytes: 2000000,
  },
  reports: { schedule: "off", recipients: [] as string[], format: "xlsx", timezone: "Asia/Kolkata" },
  notifications: { email_enabled: false, deadline_warning_days: 2 },
  security: { idle_timeout_minutes: 0, log_sign_ins: true },
}
export type Settings = typeof SETTINGS_DEFAULTS

export const getAllSettings = cache(async (): Promise<Settings> => {
  const supabase = await createClient()
  const { data } = await supabase.from("application_settings").select("key, value")
  const out = structuredClone(SETTINGS_DEFAULTS) as Record<string, Record<string, unknown>>
  for (const row of data ?? []) {
    if (row.key in out) out[row.key] = { ...out[row.key], ...(row.value as Record<string, unknown>) }
  }
  return out as unknown as Settings
})

export async function getSetting<K extends SettingsKey>(key: K): Promise<Settings[K]> {
  return (await getAllSettings())[key]
}

/** Reads every row of a query, paging past PostgREST's row cap. */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
  max = 50_000,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return out
}

export type SearchParams = Record<string, string | string[] | undefined>
export function param(sp: SearchParams, key: string): string {
  const v = sp[key]
  return (Array.isArray(v) ? v[0] : v) ?? ""
}

/**
 * Search text that is safe inside a PostgREST or=(…) filter and an ilike pattern: wildcards and the
 * filter syntax characters (, ( ) " \) are replaced by spaces. A '"' used to break the filter (error page).
 */
export function searchTerm(raw: string): string {
  return raw.trim().replace(/[%_,()*"\\]/g, " ").trim()
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function resolvePeriod(sp: SearchParams, timeZone: string, fallback: PeriodPreset = "today") {
  const period = param(sp, "period")
  const from = param(sp, "from")
  const to = param(sp, "to")
  if ((period === "custom" || (!period && from)) && DATE_RE.test(from)) {
    const end = DATE_RE.test(to) && to >= from ? to : todayIn(timeZone)
    return { preset: "custom", from, to: end < from ? from : end }
  }
  const preset = (period || fallback) as PeriodPreset
  try {
    return { preset, ...presetRange(preset, timeZone) }
  } catch {
    return { preset: fallback, ...presetRange(fallback, timeZone) }
  }
}

/** Option lists for filters and forms (Super Admin context; RLS still applies). */
/**
 * Every brand, campaign, team member, backlink type and keyword the user may read, for labels and
 * filters. Paged past the API's 1,000-row limit, and a failed read throws (the error page shows) instead
 * of silently returning empty lists.
 */
export const getLookups = cache(async (supabase: SupabaseClient) => {
  const [clients, campaigns, interns, types, keywords] = await Promise.all([
    fetchAll<{ id: string; code: string; company_name: string; status: string; timezone: string }>((a, b) =>
      supabase.from("clients").select("id, code, company_name, status, timezone").order("company_name").order("id").range(a, b)),
    fetchAll<{ id: string; code: string; name: string; client_id: string; status: string }>((a, b) =>
      supabase.from("campaigns").select("id, code, name, client_id, status").order("code").range(a, b)),
    fetchAll<{ id: string; full_name: string; email: string; status: string }>((a, b) =>
      supabase.from("profiles").select("id, full_name, email, status").eq("role", "intern").order("full_name").order("id").range(a, b)),
    fetchAll<{ id: string; name: string; is_active: boolean; sort_order: number }>((a, b) =>
      supabase.from("backlink_types").select("id, name, is_active, sort_order").order("sort_order").order("id").range(a, b)),
    fetchAll<{ id: string; keyword: string; client_id: string; status: string }>((a, b) =>
      supabase.from("keywords").select("id, keyword, client_id, status").order("keyword").order("id").range(a, b)),
  ])
  return { clients, campaigns, interns, types, keywords }
})
export type Lookups = Awaited<ReturnType<typeof getLookups>>

export function labelMaps(l: Lookups) {
  return {
    client: Object.fromEntries(l.clients.map((c) => [c.id, c.company_name])),
    campaign: Object.fromEntries(l.campaigns.map((c) => [c.id, c.code])),
    campaignName: Object.fromEntries(l.campaigns.map((c) => [c.id, `${c.code} · ${c.name}`])),
    intern: Object.fromEntries(l.interns.map((i) => [i.id, i.full_name || i.email])),
    backlink_type: Object.fromEntries(l.types.map((t) => [t.id, t.name])),
    keyword: Object.fromEntries(l.keywords.map((k) => [k.id, k.keyword])),
  }
}

export async function getPresets(supabase: SupabaseClient, page: string) {
  const { data } = await supabase.from("saved_filters").select("id, name, query").eq("page", page).order("name")
  return (data ?? []) as { id: string; name: string; query: string }[]
}

/** ISO timestamp for `hours` ago (kept out of render bodies). */
export function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}
