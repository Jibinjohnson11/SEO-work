import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { MissingConfigError, serverEnv } from "@/lib/server-env"
import { runVerificationBatch, DEFAULT_VERIFICATION_SETTINGS } from "@/lib/verification/run"
import { buildReport, pivot, presetRange, weekStart, todayIn, type ReportEvent, type TaskTarget, type SubmissionSnapshot } from "@/lib/reporting"
import { renderExport, type ExportDoc, type ExportFormat } from "@/lib/export"
import { isEmailConfigured, sendEmail } from "@/lib/email"
import { digestEmail, reportEmail } from "@/lib/email-content"
import { publicEnv } from "@/lib/env"
import { reportToExport } from "@/server/report-data"
import { SETTINGS_DEFAULTS } from "@/server/queries"

type AdminClient = ReturnType<typeof createAdminClient>

const MAX_REPORT_EMAIL_ATTEMPTS = 3

/**
 * Sends scheduled reports whose email is still pending (new today, or failed on an earlier run).
 * Each attempt is recorded on the report, so a provider outage is retried on the next run instead
 * of being lost, and a report is never emailed twice.
 */
async function deliverPendingReports(
  supabase: AdminClient,
  settings: typeof SETTINGS_DEFAULTS.reports,
  errors: string[],
): Promise<string> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data: pending, error } = await supabase
    .from("reports")
    .select("id, data, period_start, period_end, email_attempts")
    .eq("email_status", "pending")
    .gte("created_at", since)
    .order("created_at")
    .limit(10)
  if (error) {
    errors.push(`report email lookup: ${error.message}`)
    return "error"
  }
  if (!pending?.length) return "nothing pending"
  if (!isEmailConfigured()) return `skipped: RESEND_API_KEY / EMAIL_FROM not configured (${pending.length} pending)`
  if (!settings.recipients.length) {
    await supabase.from("reports").update({ email_status: "skipped" }).in("id", pending.map((r) => r.id))
    return "skipped: no recipients"
  }

  let sent = 0
  for (const r of pending) {
    const doc = r.data as ExportDoc
    const format = settings.format as ExportFormat
    const attempts = r.email_attempts + 1
    try {
      const file = await renderExport(doc, format)
      const mail = reportEmail({ id: r.id, period_start: r.period_start, period_end: r.period_end, attempt: attempts }, doc, format, publicEnv.appUrl || undefined)
      await sendEmail({
        to: settings.recipients,
        subject: mail.subject,
        text: mail.text,
        attachments: [{ filename: mail.filename, content: file }],
        idempotencyKey: mail.idempotencyKey,
      })
      const upd = await supabase
        .from("reports")
        .update({ email_status: "sent", email_attempts: attempts, emailed_at: new Date().toISOString(), email_last_error: null })
        .eq("id", r.id)
      if (upd.error) errors.push(`report ${r.id} sent but not marked: ${upd.error.message}`)
      sent++
    } catch (e) {
      const message = (e as Error).message.slice(0, 500)
      errors.push(`report ${r.id} email: ${message}`)
      await supabase
        .from("reports")
        .update({ email_status: attempts >= MAX_REPORT_EMAIL_ATTEMPTS ? "failed" : "pending", email_attempts: attempts, email_last_error: message })
        .eq("id", r.id)
    }
  }
  return `sent ${sent} of ${pending.length}`
}

/**
 * Emails a digest of unread notifications. Each user's notifications are claimed (emailed_at set)
 * before sending, so overlapping runs or a failed bookkeeping update cannot send duplicates; if the
 * send fails, the claim is released for the next run.
 */
async function deliverNotificationDigests(supabase: AdminClient, errors: string[]): Promise<string> {
  const { data: pending, error } = await supabase
    .from("notifications")
    .select("id, user_id, title, body, link, profiles!inner(email, email_notifications, status)")
    .is("emailed_at", null)
    .is("read_at", null)
    .eq("profiles.email_notifications", true)
    .eq("profiles.status", "active")
    .limit(1000)
  if (error) {
    errors.push(`digest lookup: ${error.message}`)
    return "error"
  }
  const byUser = new Map<string, { email: string; items: { id: string; title: string; body: string | null; link: string | null }[] }>()
  for (const n of (pending ?? []) as unknown as { id: string; user_id: string; title: string; body: string | null; link: string | null; profiles: { email: string } }[]) {
    const entry = byUser.get(n.user_id) ?? { email: n.profiles.email, items: [] }
    entry.items.push(n)
    byUser.set(n.user_id, entry)
  }

  let sent = 0
  for (const { email, items } of byUser.values()) {
    const claim = await supabase
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .in("id", items.map((i) => i.id))
      .is("emailed_at", null)
      .select("id")
    if (claim.error) {
      errors.push(`digest claim: ${claim.error.message}`)
      continue
    }
    const claimed = new Set((claim.data ?? []).map((c) => c.id))
    const mine = items.filter((i) => claimed.has(i.id))
    if (!mine.length) continue // another run already took them
    try {
      const mail = digestEmail(mine, publicEnv.appUrl || undefined)
      await sendEmail({ to: [email], subject: mail.subject, text: mail.text, idempotencyKey: mail.idempotencyKey })
      sent++
    } catch (e) {
      errors.push(`digest email: ${(e as Error).message.slice(0, 300)}`)
      await supabase.from("notifications").update({ emailed_at: null }).in("id", [...claimed])
    }
  }
  return `${sent} of ${byUser.size} digests`
}

export const maxDuration = 300

function authorized(request: NextRequest) {
  const secret = serverEnv.cronSecret
  const header = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${secret}`
  return Boolean(secret) && header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))
}

/**
 * Scheduled job (Vercel Cron, see vercel.json). Runs with the service role:
 * 1) deadline reminders, 2) due backlink verification, 3) scheduled report snapshot + email,
 * 4) email delivery of pending notifications (when email is configured), 5) rate-limit cleanup.
 * Responds 500 when any step failed, so the platform's cron monitoring flags the run.
 */
export async function GET(request: NextRequest) {
  if (!serverEnv.cronSecret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  let supabase
  try {
    supabase = createAdminClient()
  } catch (e) {
    if (e instanceof MissingConfigError) return NextResponse.json({ error: e.message }, { status: 503 })
    throw e
  }
  const started = Date.now()
  const { data: settingsRows } = await supabase.from("application_settings").select("key, value")
  const settings = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value])) as Record<string, Record<string, unknown>>
  const verification = { ...DEFAULT_VERIFICATION_SETTINGS, ...SETTINGS_DEFAULTS.verification, ...(settings.verification ?? {}) }
  const notifications = { ...SETTINGS_DEFAULTS.notifications, ...(settings.notifications ?? {}) }
  const reports = { ...SETTINGS_DEFAULTS.reports, ...(settings.reports ?? {}) } as typeof SETTINGS_DEFAULTS.reports
  const summary: Record<string, unknown> = {}
  const errors: string[] = []

  const due = await supabase.rpc("notify_due_tasks", { p_days: notifications.deadline_warning_days })
  if (due.error) errors.push(`deadline reminders: ${due.error.message}`)
  summary.deadline_reminders = due.error ? "error" : due.data

  if (verification.auto_verify) {
    try {
      summary.verification = await runVerificationBatch(supabase, verification, { budgetMs: 180_000 })
    } catch (e) {
      errors.push(`verification: ${(e as Error).message}`)
      summary.verification = "error"
    }
  } else summary.verification = "disabled"

  // Scheduled report: daily → yesterday, weekly → last week (on Mondays), monthly → last month (on the 1st).
  const tz = reports.timezone
  const today = todayIn(tz)
  const runReport =
    reports.schedule === "daily" ||
    (reports.schedule === "weekly" && weekStart(today) === today) ||
    (reports.schedule === "monthly" && today.endsWith("-01"))
  if (runReport) {
    const preset = reports.schedule === "daily" ? "yesterday" : reports.schedule === "weekly" ? "last_week" : "last_month"
    const period = presetRange(preset, tz)
    const { data: existing } = await supabase
      .from("reports")
      .select("id")
      .eq("is_scheduled", true)
      .eq("kind", reports.schedule)
      .eq("period_start", period.from)
      .is("client_id", null)
      .maybeSingle()
    if (existing) summary.report = "already generated"
    else {
      const range = { start: `${period.from}T00:00:00Z`, end: `${period.to}T23:59:59Z` }
      // Pad by a day each side; buildReport trims to calendar dates in the report time zone.
      const pad = (d: string, days: number) => new Date(new Date(d).getTime() + days * 86400_000).toISOString()
      const [ev, tk, sb, cl, cp, it, ty, kw] = await Promise.all([
        supabase.from("report_events").select("submission_id, metric, occurred_at, client_id, campaign_id, keyword_id, intern_id, backlink_type_id").gte("occurred_at", pad(range.start, -1)).lte("occurred_at", pad(range.end, 1)).limit(50000),
        supabase.from("tasks").select("id, intern_id, campaign_id, client_id, keyword_id, backlink_type_id, cadence, target_quantity, start_date, due_date, status").lte("start_date", period.to).neq("status", "cancelled").limit(50000),
        supabase.from("backlink_submissions").select("id, status, first_submitted_at, client_id, campaign_id, keyword_id, intern_id, backlink_type_id").gte("first_submitted_at", pad(range.start, -1)).lte("first_submitted_at", pad(range.end, 1)).limit(50000),
        supabase.from("clients").select("id, company_name"),
        supabase.from("campaigns").select("id, code, status"),
        supabase.from("profiles").select("id, full_name").eq("role", "intern"),
        supabase.from("backlink_types").select("id, name"),
        supabase.from("keywords").select("id, keyword"),
      ])
      // A partial read would save a report full of wrong zeros; skip it and retry on the next run.
      const readError = [ev, tk, sb, cl, cp, it, ty, kw].find((r) => r.error)?.error
      if (readError) {
        errors.push(`scheduled report data: ${readError.message}`)
        summary.report = "error"
      } else {
        const labels = {
          client: Object.fromEntries((cl.data ?? []).map((c) => [c.id, c.company_name])),
          campaign: Object.fromEntries((cp.data ?? []).map((c) => [c.id, c.code])),
          intern: Object.fromEntries((it.data ?? []).map((c) => [c.id, c.full_name])),
          backlink_type: Object.fromEntries((ty.data ?? []).map((c) => [c.id, c.name])),
          keyword: Object.fromEntries((kw.data ?? []).map((c) => [c.id, c.keyword])),
        }
        const events = (ev.data ?? []) as ReportEvent[]
        const report = buildReport({ events, tasks: (tk.data ?? []) as TaskTarget[], submissions: (sb.data ?? []) as SubmissionSnapshot[], from: period.from, to: period.to, timeZone: tz, groupBy: ["campaign"], labels })
        const matrix = pivot({ events, metric: "submitted", rowDim: "campaign", colDim: "backlink_type", from: period.from, to: period.to, timeZone: tz, labels, includeRows: (cp.data ?? []).filter((c) => c.status === "active").map((c) => c.id) })
        const doc = reportToExport({ report, matrix, groupBy: "campaign", period: { preset, ...period }, timeZone: tz }, `Scheduled ${reports.schedule} backlink report`)
        const ins = await supabase
          .from("reports")
          .insert({
            kind: reports.schedule, title: doc.title, period_start: period.from, period_end: period.to, timezone: tz, data: doc, is_scheduled: true,
            email_status: reports.recipients.length ? "pending" : "skipped",
          })
          .select("id")
          .single()
        if (ins.error) errors.push(`scheduled report: ${ins.error.message}`)
        summary.report = ins.error ? "error" : ins.data.id
      }
    }
  }
  summary.report_email = await deliverPendingReports(supabase, reports, errors)

  // Email digest of unread notifications for users who opted in.
  if (notifications.email_enabled) {
    summary.notification_email = isEmailConfigured()
      ? await deliverNotificationDigests(supabase, errors)
      : "skipped: RESEND_API_KEY / EMAIL_FROM not configured"
  }

  const purge = await supabase.rpc("purge_rate_limits")
  if (purge.error) errors.push(`rate-limit cleanup: ${purge.error.message}`)
  summary.rate_limits_purged = purge.error ? "error" : purge.data

  if (errors.length) console.error("[cron] completed with errors", errors)
  return NextResponse.json({ ok: errors.length === 0, ms: Date.now() - started, ...summary, errors }, { status: errors.length ? 500 : 200 })
}
