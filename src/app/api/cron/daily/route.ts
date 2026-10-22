import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { MissingConfigError, serverEnv } from "@/lib/server-env"
import { runVerificationBatch, DEFAULT_VERIFICATION_SETTINGS } from "@/lib/verification/run"
import { scheduledReportAnchor, todayIn } from "@/lib/reporting"
import { renderExport, type ExportDoc, type ExportFormat } from "@/lib/export"
import { isEmailConfigured, sendEmail } from "@/lib/email"
import { digestEmail, reportEmail } from "@/lib/email-content"
import { publicEnv } from "@/lib/env"
import { SETTINGS_DEFAULTS } from "@/server/queries"
import { REPORT_PERIODS, unifiedReport, unifiedToExport } from "@/server/unified-report"

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
 * Scheduled job (Render cron job `linkops-daily`, see render.yaml). Runs with the service role:
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
  // Built by the same code as the Reports page (unifiedReport), so a scheduled snapshot has the same
  // columns and counts as a snapshot saved there, and reads every row (paged past the API row limit).
  const tz = reports.timezone
  const anchor = scheduledReportAnchor(reports.schedule, todayIn(tz))
  if (anchor) {
    const schedule = reports.schedule as "daily" | "weekly" | "monthly"
    try {
      const ctx = await unifiedReport(supabase, { period: schedule, date: anchor }, tz)
      const { data: existing } = await supabase
        .from("reports")
        .select("id")
        .eq("is_scheduled", true)
        .eq("kind", schedule)
        .eq("period_start", ctx.range.from)
        .is("client_id", null)
        .maybeSingle()
      if (existing) summary.report = "already generated"
      else {
        const doc = unifiedToExport(ctx, `Scheduled ${REPORT_PERIODS[schedule].toLowerCase()} backlink report`)
        const ins = await supabase
          .from("reports")
          .insert({
            kind: schedule, title: doc.title, period_start: ctx.range.from, period_end: ctx.range.to, timezone: tz, data: doc, is_scheduled: true,
            filters: { period: schedule, date: anchor },
            email_status: reports.recipients.length ? "pending" : "skipped",
          })
          .select("id")
          .single()
        if (ins.error) errors.push(`scheduled report: ${ins.error.message}`)
        summary.report = ins.error ? "error" : ins.data.id
      }
    } catch (e) {
      // A partial read would save a report full of wrong zeros; skip it and retry on the next run.
      errors.push(`scheduled report data: ${(e as { message?: string }).message ?? String(e)}`)
      summary.report = "error"
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
