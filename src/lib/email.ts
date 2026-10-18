import "server-only"
import { serverEnv } from "@/lib/server-env"
import { assertAllowedRecipients } from "@/lib/email-allowlist"

export function isEmailConfigured() {
  return Boolean(serverEnv.resendApiKey && serverEnv.emailFrom)
}

const TIMEOUT_MS = 15_000
const RETRY_DELAY_MS = 2_000

/** Rate limits and provider-side errors are worth one more try; other 4xx responses are not. */
function retryable(status: number) {
  return status === 429 || status >= 500
}

/**
 * Sends through Resend's HTTP API. Returns false (never pretends success) when not configured,
 * the provider's message id when sent, and throws when delivery failed. Retries once on a
 * timeout, network error, rate limit or provider error. Throws EmailRecipientBlockedError, without
 * contacting the provider, when EMAIL_ALLOWED_RECIPIENTS is set and a recipient is not on it.
 */
export async function sendEmail(msg: {
  to: string[]
  subject: string
  text: string
  attachments?: { filename: string; content: Buffer }[]
  /** Sent on every attempt, so Resend delivers at most one email even if a retry follows a lost response. */
  idempotencyKey?: string
}): Promise<false | { id: string | null }> {
  if (!isEmailConfigured() || msg.to.length === 0) return false
  assertAllowedRecipients(msg.to)
  const body = JSON.stringify({
    from: serverEnv.emailFrom,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
  })

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    let res: Response
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serverEnv.resendApiKey}`,
          "Content-Type": "application/json",
          ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      lastError = new Error(`Email provider unreachable: ${(e as Error).message}`)
      continue
    }
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { id?: string } | null
      return { id: json?.id ?? null }
    }
    lastError = new Error(`Email provider error ${res.status}: ${(await res.text()).slice(0, 200)}`)
    if (!retryable(res.status)) break
  }
  throw lastError
}
