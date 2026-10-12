import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { MissingConfigError, serverEnv } from "@/lib/server-env"
import { runVerificationBatch, DEFAULT_VERIFICATION_SETTINGS } from "@/lib/verification/run"
import { buildReport, pivot, presetRange, weekStart, todayIn, type ReportEvent, type TaskTarget, type SubmissionSnapshot } from "@/lib/reporting"
import { renderExport, type ExportFormat } from "@/lib/export"
import { isEmailConfigured, sendEmail } from "@/lib/email"
import { reportToExport } from "@/server/report-data"
import { SETTINGS_DEFAULTS } from "@/server/queries"

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
 * 4) email delivery of pending notifications (when email is configured).
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

  const due = await supabase.rpc("notify_due_tasks", { p_days: notifications.deadline_warning_days })
  summary.deadline_reminders = due.error ? `error: ${due.error.message}` : due.data

  if (verification.auto_verify) {
    try {
      summary.verification = await runVerificationBatch(supabase, verification, { budgetMs: 180_000 })
    } catch (e) {
      summary.verification = `error: ${(e as Error).message}`
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
      const ins = await supabase.from("reports").insert({ kind: reports.schedule, title: doc.title, period_start: period.from, period_end: period.to, timezone: tz, data: doc, is_scheduled: true }).select("id").single()
      summary.report = ins.error ? `error: ${ins.error.message}` : ins.data.id
      if (!ins.error && reports.recipients.length) {
        if (!isEmailConfigured()) summary.report_email = "skipped: RESEND_API_KEY / EMAIL_FROM not configured"
        else {
          const format = reports.format as ExportFormat
          const file = await renderExport(doc, format)
          await sendEmail({
            to: reports.recipients,
            subject: `${doc.title} · ${period.from === period.to ? period.from : `${period.from} – ${period.to}`}`,
            text: `${doc.subtitle}\n\nSubmitted: ${report.totals.submitted}\nClient approved: ${report.totals.client_approved}\nPublished: ${report.totals.published}\nVerified live: ${report.totals.verified_live}`,
            attachments: [{ filename: `report-${period.from}.${format}`, content: file }],
          })
          summary.report_email = `sent to ${reports.recipients.length}`
        }
      }
    }
  }

  // Email digest of unread notifications for users who opted in.
  if (notifications.email_enabled) {
    if (!isEmailConfigured()) summary.notification_email = "skipped: RESEND_API_KEY / EMAIL_FROM not configured"
    else {
      const { data: pending } = await supabase
        .from("notifications")
        .select("id, user_id, title, body, profiles!inner(email, email_notifications, status)")
        .is("emailed_at", null)
        .is("read_at", null)
        .eq("profiles.email_notifications", true)
        .eq("profiles.status", "active")
        .limit(1000)
      const byUser = new Map<string, { email: string; items: { id: string; title: string; body: string | null }[] }>()
      for (const n of (pending ?? []) as unknown as { id: string; user_id: string; title: string; body: string | null; profiles: { email: string } }[]) {
        const entry = byUser.get(n.user_id) ?? { email: n.profiles.email, items: [] }
        entry.items.push(n)
        byUser.set(n.user_id, entry)
      }
      let sent = 0
      for (const { email, items } of byUser.values()) {
        try {
          await sendEmail({ to: [email], subject: `You have ${items.length} new notification${items.length > 1 ? "s" : ""}`, text: items.map((i) => `• ${i.title}${i.body ? ` — ${i.body}` : ""}`).join("\n") })
          await supabase.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", items.map((i) => i.id))
          sent++
        } catch (e) {
          summary.notification_email_error = (e as Error).message
        }
      }
      summary.notification_email = `${sent} digests`
    }
  }

  return NextResponse.json({ ok: true, ms: Date.now() - started, ...summary })
}
