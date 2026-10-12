import "server-only"
import robotsParser from "robots-parser"
import type { SupabaseClient } from "@supabase/supabase-js"
import { BlockedUrlError, safeFetch } from "@/lib/verification/net"
import { classify } from "@/lib/verification/links"
import type { LinkAttribute, PublishedBacklink } from "@/lib/types"

export interface VerificationSettings {
  timeout_ms: number
  max_per_run: number
  per_domain_delay_ms: number
  respect_robots: boolean
  max_redirects: number
  max_bytes: number
  recheck_interval_hours: number
}

export const DEFAULT_VERIFICATION_SETTINGS: VerificationSettings = {
  timeout_ms: 10_000,
  max_per_run: 25,
  per_domain_delay_ms: 2000,
  respect_robots: true,
  max_redirects: 5,
  max_bytes: 2_000_000,
  recheck_interval_hours: 72,
}

const USER_AGENT = "LinkOpsVerifier/1.0 (+backlink verification for site owners' approved placements)"

const robotsCache = new Map<string, { allowed: (url: string) => boolean; at: number }>()

async function robotsAllows(pageUrl: string, settings: VerificationSettings) {
  const origin = new URL(pageUrl).origin
  const cached = robotsCache.get(origin)
  if (cached && Date.now() - cached.at < 3600_000) return cached.allowed(pageUrl)
  let allowed: (url: string) => boolean = () => true
  try {
    const res = await safeFetch(`${origin}/robots.txt`, {
      timeoutMs: Math.min(settings.timeout_ms, 5000),
      maxBytes: 500_000,
      maxRedirects: 2,
      userAgent: USER_AGENT,
      accept: "text/plain,*/*;q=0.5",
    })
    if (res.status >= 200 && res.status < 300) {
      const robots = robotsParser(`${origin}/robots.txt`, res.body)
      allowed = (url) => robots.isAllowed(url, USER_AGENT) !== false
    } else if (res.status === 401 || res.status === 403) {
      allowed = () => false
    }
  } catch {
    // Unreachable robots.txt: proceed, the page fetch will report reachability.
  }
  robotsCache.set(origin, { allowed, at: Date.now() })
  return allowed(pageUrl)
}

export type CheckPayload = ReturnType<typeof classify> & {
  method: "automated"
  http_status: number | null
  final_url: string | null
  robots_allowed: boolean | null
  response_time_ms: number | null
}

/** Fetches the published page and classifies the link. Never throws. */
export async function checkBacklink(
  backlink: Pick<PublishedBacklink, "published_url" | "target_url" | "anchor_text" | "link_attribute">,
  settings: VerificationSettings = DEFAULT_VERIFICATION_SETTINGS,
): Promise<CheckPayload> {
  const base = { method: "automated" as const, http_status: null, final_url: null, response_time_ms: null }
  let robotsAllowed: boolean | null = null
  try {
    if (settings.respect_robots) {
      robotsAllowed = await robotsAllows(backlink.published_url, settings)
      if (!robotsAllowed)
        return { ...base, robots_allowed: false, ...classify({ httpStatus: null, pageUrl: backlink.published_url, targetUrl: backlink.target_url, robotsAllowed: false }) }
    }
    const res = await safeFetch(backlink.published_url, {
      timeoutMs: settings.timeout_ms,
      maxBytes: settings.max_bytes,
      maxRedirects: settings.max_redirects,
      userAgent: USER_AGENT,
    })
    return {
      method: "automated",
      http_status: res.status,
      final_url: res.finalUrl,
      response_time_ms: res.elapsedMs,
      robots_allowed: robotsAllowed,
      ...classify({
        httpStatus: res.status,
        contentType: res.contentType,
        html: res.body,
        pageUrl: res.finalUrl,
        targetUrl: backlink.target_url,
        expectedAnchor: backlink.anchor_text,
        expectedAttribute: backlink.link_attribute as LinkAttribute,
      }),
    }
  } catch (error) {
    const message = (error as Error).message || "Request failed"
    return {
      ...base,
      robots_allowed: robotsAllowed,
      ...classify({
        httpStatus: null,
        pageUrl: backlink.published_url,
        targetUrl: backlink.target_url,
        ...(error instanceof BlockedUrlError ? { blockedReason: message } : { networkError: message }),
      }),
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Checks due backlinks sequentially with a per-domain delay and a wall-clock budget, writing
 * each result through public.record_verification(). `supabase` must be allowed to call it
 * (Super Admin session or service role).
 */
export async function runVerificationBatch(
  supabase: SupabaseClient,
  settings: VerificationSettings,
  opts: { ids?: string[]; budgetMs?: number } = {},
) {
  const budget = opts.budgetMs ?? 50_000
  const started = Date.now()
  let query = supabase
    .from("published_backlinks")
    .select("id, published_url, publisher_domain, target_url, anchor_text, link_attribute, last_checked_at, backlink_submissions!inner(status)")
    .neq("backlink_submissions.status", "archived")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(settings.max_per_run)
  if (opts.ids?.length) query = query.in("id", opts.ids)
  else {
    const dueBefore = new Date(Date.now() - settings.recheck_interval_hours * 3600_000).toISOString()
    query = query.or(`last_checked_at.is.null,last_checked_at.lt.${dueBefore}`)
  }
  const { data, error } = await query
  if (error) throw error

  const lastHit = new Map<string, number>()
  const results: { id: string; result: string; error: string | null }[] = []
  for (const row of data ?? []) {
    if (Date.now() - started > budget) break
    const wait = (lastHit.get(row.publisher_domain) ?? 0) + settings.per_domain_delay_ms - Date.now()
    if (wait > 0) await sleep(wait)
    const check = await checkBacklink(row as unknown as PublishedBacklink, settings)
    lastHit.set(row.publisher_domain, Date.now())
    const { error: rpcError } = await supabase.rpc("record_verification", { p_published_id: row.id, p_check: check })
    results.push({ id: row.id, result: rpcError ? "error" : check.result, error: rpcError?.message ?? check.error })
  }
  return { checked: results.length, remaining: Math.max(0, (data?.length ?? 0) - results.length), results }
}
