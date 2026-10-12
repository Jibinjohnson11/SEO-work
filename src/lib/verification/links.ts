import { parse } from "node-html-parser"
import { normalizeUrl } from "@/lib/url"
import type { LinkAttribute, VerificationResult } from "@/lib/types"

export interface FoundLink {
  href: string
  text: string
  rel: string[]
}

/** All anchors on the page with absolute hrefs (respects <base href>). */
export function extractLinks(html: string, pageUrl: string): FoundLink[] {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false } })
  let base = pageUrl
  const baseHref = root.querySelector("base[href]")?.getAttribute("href")
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).toString()
    } catch {
      // ignore malformed <base>
    }
  }
  const links: FoundLink[] = []
  for (const a of root.querySelectorAll("a[href]")) {
    const raw = a.getAttribute("href")?.trim()
    if (!raw || /^(javascript|mailto|tel|data):/i.test(raw)) continue
    let href: string
    try {
      href = new URL(raw, base).toString()
    } catch {
      continue
    }
    const text =
      a.textContent.replace(/\s+/g, " ").trim() ||
      a.querySelector("img[alt]")?.getAttribute("alt")?.trim() ||
      a.getAttribute("title")?.trim() ||
      a.getAttribute("aria-label")?.trim() ||
      ""
    const rel = (a.getAttribute("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    links.push({ href, text, rel })
  }
  return links
}

export function attributeFromRel(rel: string[]): LinkAttribute {
  if (rel.includes("sponsored")) return "sponsored"
  if (rel.includes("ugc")) return "ugc"
  if (rel.includes("nofollow")) return "nofollow"
  return "dofollow"
}

const normText = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase()

export interface ClassifyInput {
  httpStatus: number | null
  contentType?: string
  html?: string
  pageUrl: string
  targetUrl: string
  expectedAnchor?: string | null
  expectedAttribute?: LinkAttribute | null
  networkError?: string | null
  robotsAllowed?: boolean | null
  blockedReason?: string | null
}

export interface ClassifiedCheck {
  result: VerificationResult
  link_found: boolean | null
  found_anchor_text: string | null
  found_rel: string[]
  detected_attribute: LinkAttribute | null
  error: string | null
}

/**
 * Decides the verification outcome. An HTTP 200 alone is never treated as proof: the target
 * URL must be present as a hyperlink in the served HTML.
 */
export function classify(input: ClassifyInput): ClassifiedCheck {
  const none = { link_found: null, found_anchor_text: null, found_rel: [], detected_attribute: null }
  if (input.blockedReason) return { ...none, result: "inconclusive", error: `Not fetched: ${input.blockedReason}` }
  if (input.robotsAllowed === false)
    return { ...none, result: "inconclusive", error: "robots.txt disallows automated access; verify manually" }
  if (input.networkError) return { ...none, result: "unreachable", error: input.networkError }
  const status = input.httpStatus ?? 0
  if (status === 404 || status === 410)
    return { ...none, link_found: false, result: "missing", error: `Page returned HTTP ${status}` }
  if (status === 401 || status === 403 || status === 429)
    return { ...none, result: "inconclusive", error: `Access restricted (HTTP ${status}); verify manually` }
  if (status < 200 || status >= 300) return { ...none, result: "unreachable", error: `HTTP ${status}` }
  if (input.contentType && !/html|xml/i.test(input.contentType))
    return { ...none, result: "inconclusive", error: `Unsupported content type ${input.contentType}` }

  const links = extractLinks(input.html ?? "", input.pageUrl)
  const target = normalizeUrl(input.targetUrl)
  const matches = links.filter((l) => normalizeUrl(l.href) === target)
  if (!matches.length) {
    // Script-rendered pages may not expose links in server HTML.
    if (links.length < 3)
      return {
        ...none,
        link_found: false,
        result: "inconclusive",
        error: "Page exposes almost no links in its HTML (likely rendered by JavaScript); verify manually",
      }
    return { ...none, link_found: false, result: "missing", error: "Target URL not found among page links" }
  }

  // Prefer the occurrence that matches the expected anchor text.
  const expected = normText(input.expectedAnchor)
  const best = (expected && matches.find((m) => normText(m.text) === expected)) || matches[0]
  const attribute = attributeFromRel(best.rel)
  const anchorChanged = Boolean(expected) && normText(best.text) !== expected
  const attributeChanged =
    Boolean(input.expectedAttribute) && input.expectedAttribute !== "unknown" && input.expectedAttribute !== attribute
  const changes = [
    anchorChanged && `anchor text is "${best.text}"`,
    attributeChanged && `link is ${attribute} (expected ${input.expectedAttribute})`,
  ].filter(Boolean)
  return {
    result: changes.length ? "changed" : "live",
    link_found: true,
    found_anchor_text: best.text || null,
    found_rel: best.rel,
    detected_attribute: attribute,
    error: changes.length ? `Changed: ${changes.join("; ")}` : null,
  }
}
