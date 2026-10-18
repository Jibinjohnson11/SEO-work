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

// Characters a redirect target may never contain. Browsers and the WHATWG URL parser silently drop
// tab/CR/LF ("/\t/evil.com" becomes "//evil.com", another site) and treat "\\" like "/", so these are
// refused outright, together with every other control, whitespace and invisible formatting character.
const UNSAFE_REDIRECT_CHARS = /[\u0000-\u0020\u007F-\u00A0\u00AD\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF\\]/
const REDIRECT_BASE = "http://redirect-check.invalid"

/**
 * Allows only relative in-app paths such as "/admin/clients?status=active" (prevents open
 * redirects through ?next=). Anything else, including absolute and protocol-relative URLs, returns
 * `fallback`. As a final check the path is resolved the way a browser would and must stay on this origin.
 */
export function safeRedirectPath(input: string | null | undefined, fallback = "/"): string {
  if (!input || input.length > 2048 || !input.startsWith("/") || input.startsWith("//") || UNSAFE_REDIRECT_CHARS.test(input)) return fallback
  try {
    if (new URL(input, REDIRECT_BASE).origin !== REDIRECT_BASE) return fallback
  } catch {
    return fallback
  }
  return input
}
