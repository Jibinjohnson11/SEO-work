// One Resend delivery test for STAGING, through the app's own integration (src/lib/email.ts).
//
//   npm run staging:email-test             validate only: sends nothing
//   npm run staging:email-test -- --send   send exactly one email
//   … -- --sample=digest|report [--send]   instead, one representative app email built from SYNTHETIC
//                                          data by the daily job's own templates (src/lib/email-content.ts)
//
// Runs only through scripts/staging-env.mjs (staging values, production shadowed). Reads from .env.e2e:
//   RESEND_API_KEY   the staging app key (never printed)
//   RESEND_TEST_TO   your verified Resend account email: the only recipient
// The sender is fixed to onboarding@resend.dev, and the allowlist is narrowed to RESEND_TEST_TO alone.
// Digests and scheduled reports are not involved: no database is read or written.
import { randomUUID } from "node:crypto"
import { register } from "node:module"

const SUBJECT = "LinkOps Staging Email Test"
const FROM = "LinkOps Staging <onboarding@resend.dev>"
const send = process.argv.includes("--send")
const sample = process.argv.find((a) => a.startsWith("--sample="))?.slice(9) ?? null
if (sample && !["digest", "report"].includes(sample)) {
  console.error("[email-test] --sample must be digest or report")
  process.exit(2)
}

function refuse(msg) {
  console.error(`[email-test] refused: ${msg}`)
  process.exit(2)
}

if (process.env.LINKOPS_ENVIRONMENT !== "staging") refuse("run it through the staging loader (npm run staging:email-test)")
if (process.execArgv.join(" ").indexOf("react-server") === -1) refuse("needs node --conditions=react-server (use the npm script)")
const key = process.env.RESEND_API_KEY ?? ""
const to = (process.env.RESEND_TEST_TO ?? "").trim().toLowerCase()
if (!key) refuse("RESEND_API_KEY is empty in .env.e2e")
if (!key.startsWith("re_")) refuse("RESEND_API_KEY does not look like a Resend key")
if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(to)) refuse("set RESEND_TEST_TO in .env.e2e to your verified Resend account email (one address)")

// This run only: fixed sender, and only the one recipient is allowed.
process.env.EMAIL_FROM = FROM
process.env.EMAIL_ALLOWED_RECIPIENTS = to

const masked = `${to.slice(0, 2)}…@${to.split("@")[1]}`

// Load the app's TypeScript module: map "@/…" to src/ and add the .ts extension.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      const root = ${JSON.stringify(new URL("../src/", import.meta.url).href)}
      export async function resolve(spec, ctx, next) {
        if (spec.startsWith("@/")) spec = root + spec.slice(2)
        if ((spec.startsWith(root) || (spec.startsWith(".") && ctx.parentURL?.startsWith(root))) && !/\\.[cm]?[jt]sx?$/.test(spec)) spec += ".ts"
        return next(spec, ctx)
      }`),
)
const { sendEmail } = await import("../src/lib/email.ts")

// Synthetic sample data only — no database is read, so no real user or client data can be included.
const APP = process.env.NEXT_PUBLIC_APP_URL || undefined
const day = new Date().toISOString().slice(0, 10)
let message = {
  subject: SUBJECT,
  text: `This is a single delivery test from LinkOps staging (project flvdmarzdthbtobezxhn).\nSent ${new Date().toISOString()}.\nNo action is needed.`,
  idempotencyKey: `linkops-staging-email-test-${randomUUID()}`,
}
if (sample) {
  const { digestEmail, reportEmail } = await import("../src/lib/email-content.ts")
  if (sample === "digest") {
    const m = digestEmail(
      [
        { id: "sample-1", title: "[SAMPLE] CMP-001 approved by client", body: "Guest post on publisher.example", link: "/intern/notifications" },
        { id: "sample-2", title: "[SAMPLE] Client requested changes on CMP-002", body: "Please shorten the introduction.", link: "/intern/notifications" },
      ],
      APP,
    )
    message = { subject: `[STAGING SAMPLE] ${m.subject}`, text: m.text, idempotencyKey: `linkops-staging-sample-digest-${day}` }
  } else {
    const { renderExport } = await import("../src/lib/export.ts")
    const doc = {
      title: "Scheduled daily backlink report",
      subtitle: `[SAMPLE DATA] ${day} · Asia/Kolkata`,
      sheets: [{
        name: "Report",
        columns: [{ key: "dim", header: "Campaign" }, { key: "submitted", header: "Submitted", numeric: true }, { key: "client_approved", header: "Client Approved", numeric: true }, { key: "published", header: "Published", numeric: true }, { key: "verified_live", header: "Verified Live", numeric: true }],
        rows: [{ dim: "SAMPLE-001", submitted: 3, client_approved: 2, published: 1, verified_live: 1 }, { dim: "SAMPLE-002", submitted: 1, client_approved: 0, published: 0, verified_live: 0 }],
        footer: { dim: "Total", submitted: 4, client_approved: 2, published: 1, verified_live: 1 },
      }],
    }
    const m = reportEmail({ id: "sample", period_start: day, period_end: day, attempt: 1 }, doc, "csv", APP)
    message = { subject: `[STAGING SAMPLE] ${m.subject}`, text: m.text, idempotencyKey: `linkops-staging-sample-report-${day}`, attachments: [{ filename: m.filename, content: await renderExport(doc, "csv") }] }
  }
}

console.log(`[email-test] staging · from ${FROM} · to ${masked} · subject "${message.subject}"${message.attachments ? ` · attachment ${message.attachments[0].filename} (${message.attachments[0].content.length} bytes)` : ""}`)
if (!send) {
  console.log("----- message body (dry run) -----\n" + message.text + "\n----------------------------------")
  console.log("[email-test] validation OK. Nothing sent. Re-run with --send to send exactly one email.")
  process.exit(0)
}

let result
try {
  result = await sendEmail({ to: [to], ...message })
} catch (e) {
  console.error(`[email-test] NOT accepted: ${e.message.replaceAll(key, "[key]")}`)
  process.exit(1)
}
if (!result) refuse("email is not configured (RESEND_API_KEY / EMAIL_FROM)")
console.log(`[email-test] accepted by Resend · id ${result.id}`)

// Delivery status: needs a key with read access; a sending-only key is refused here (expected).
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5_000))
  const res = await fetch(`https://api.resend.com/emails/${result.id}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res) continue
  if (res.status === 401 || res.status === 403) {
    console.log("[email-test] delivery status not readable with this key (sending-only). Check Resend → Emails for this id.")
    process.exit(0)
  }
  const body = await res.json().catch(() => null)
  const event = body?.last_event
  if (event && event !== "queued" && event !== "sent") {
    console.log(`[email-test] delivery status: ${event}`)
    process.exit(event === "delivered" ? 0 : 1)
  }
}
console.log("[email-test] delivery not confirmed within 60 s (still queued/sent). Check Resend → Emails for this id.")
