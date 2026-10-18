import type { Instrumentation } from "next"

// Required in production. The app keeps running without them (pages show /setup, features report
// "not configured"), but a deployment missing any of these is not production-ready.
const REQUIRED_IN_PRODUCTION = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "CRON_SECRET",
] as const

/** Runs once when a server instance starts: logs missing production configuration loudly. */
export function register() {
  if (process.env.NODE_ENV !== "production") return
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => {
    if (name === "NEXT_PUBLIC_SUPABASE_ANON_KEY") return !process.env[name] && !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (name === "SUPABASE_SERVICE_ROLE_KEY") return !process.env[name] && !process.env.SUPABASE_SECRET_KEY
    return !process.env[name]
  })
  if (missing.length) console.error(`[startup] missing production configuration: ${missing.join(", ")}`)
  const onCloudflare = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent === "Cloudflare-Workers"
  if (!process.env.CLIENT_IP_HEADER && !process.env.VERCEL && !onCloudflare)
    console.warn("[startup] CLIENT_IP_HEADER not set: no trusted client-IP header on this host, so IP-based sign-in limits are off (per-email limits still apply)")
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    console.warn("[startup] RESEND_API_KEY / EMAIL_FROM not set: notification digests and scheduled report emails are off")
}

/**
 * One structured log line per unhandled server error, so the hosting platform's log search and
 * alerting can find them. The digest matches the "Reference" shown on the error screen.
 * To forward errors to an external tracker (e.g. Sentry), add the call here.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const error = err as { message?: string; digest?: string; stack?: string }
  console.error(
    JSON.stringify({
      level: "error",
      event: "request_error",
      digest: error?.digest,
      message: error?.message ?? String(err),
      method: request.method,
      path: request.path,
      routePath: context.routePath,
      routeType: context.routeType,
      stack: error?.stack?.split("\n").slice(0, 8).join("\n"),
    }),
  )
}
