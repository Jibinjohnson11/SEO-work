/**
 * Canonical URL form used for duplicate detection and link matching.
 * Must stay identical to public.normalize_url() in the database (tests/db/workflow.test.ts
 * compares the two). http/https and "www." are treated as equivalent, fragments and
 * trailing slashes are ignored, query strings are kept.
 */
export function normalizeUrl(input: string | null | undefined): string | null {
  let v = (input ?? "").trim()
  if (!v) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`
  v = v.replace(/#[\s\S]*$/, "")
  const m = v.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?]+)([^?]*)(\?[\s\S]*)?$/)
  if (!m) return v.toLowerCase()
  let host = m[1].replace(/^[\s\S]*@/, "").toLowerCase()
  host = host.replace(/:(80|443)$/, "").replace(/^www\./, "").replace(/\.$/, "")
  const path = (m[2] ?? "").replace(/\/+$/, "")
  let query = m[3] ?? ""
  if (query === "?") query = ""
  return `https://${host}${path}${query}`
}

export function urlDomain(input: string | null | undefined): string | null {
  const n = normalizeUrl(input)
  if (!n) return null
  const m = n.match(/^https:\/\/([^/?:]+)/)
  return m ? m[1] : null
}

/** Same rule as public.is_http_url(). */
export function isHttpUrl(input: string | null | undefined): boolean {
  return /^https?:\/\/[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$/i.test((input ?? "").trim())
}

/** Allows only relative in-app paths (prevents open redirects through ?next=). */
export function safeRedirectPath(input: string | null | undefined, fallback = "/"): string {
  if (!input || !input.startsWith("/") || input.startsWith("//") || input.includes("\\")) return fallback
  return input
}
