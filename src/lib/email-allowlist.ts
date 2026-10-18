/**
 * Recipient allowlist for non-production environments. When EMAIL_ALLOWED_RECIPIENTS is set, the
 * app sends email (its own, and the Supabase Auth emails it triggers) only to addresses that match
 * an entry, so staging can never reach a real client. Unset (production) means unrestricted.
 *
 *   EMAIL_ALLOWED_RECIPIENTS="@resend.dev, qa@your-domain.com"
 *
 * Entries are comma or whitespace separated: "@domain" matches that exact domain, anything else
 * must equal the whole address. Matching ignores case.
 */
export type Allowlist = { domains: string[]; addresses: string[] } | null

export function parseAllowlist(raw: string | undefined | null): Allowlist {
  const entries = (raw ?? "")
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (!entries.length) return null
  return {
    domains: entries.filter((e) => e.startsWith("@") && e.length > 1).map((e) => e.slice(1)),
    addresses: entries.filter((e) => !e.startsWith("@") && e.includes("@")),
  }
}

export function isAllowedRecipient(email: string, list: Allowlist) {
  if (!list) return true
  const e = email.trim().toLowerCase()
  const at = e.lastIndexOf("@")
  if (at < 1) return false
  return list.addresses.includes(e) || list.domains.includes(e.slice(at + 1))
}

/** The allowlist configured for this server process (null when unrestricted). */
export function emailAllowlist(): Allowlist {
  return parseAllowlist(process.env.EMAIL_ALLOWED_RECIPIENTS)
}

/** Raised instead of sending; the message never includes the address itself. */
export class EmailRecipientBlockedError extends Error {
  constructor(count: number) {
    super(`${count} recipient${count === 1 ? " is" : "s are"} not on EMAIL_ALLOWED_RECIPIENTS; nothing was sent`)
    this.name = "EmailRecipientBlockedError"
  }
}

/** Throws EmailRecipientBlockedError when any recipient is outside the allowlist. */
export function assertAllowedRecipients(to: string[], list: Allowlist = emailAllowlist()) {
  const blocked = to.filter((t) => !isAllowedRecipient(t, list)).length
  if (blocked) throw new EmailRecipientBlockedError(blocked)
}

export const BLOCKED_RECIPIENT_MESSAGE = "This test environment only sends email to approved test addresses."
