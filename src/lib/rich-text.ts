import { parse, NodeType, type HTMLElement, type Node } from "node-html-parser"

// Allow-list sanitizer for content written in the rich-text editor: headings, paragraphs, lists,
// basic emphasis and http(s)/mailto links. Everything else is unwrapped (text kept) or dropped.

const ALLOWED = new Set(["p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "blockquote"])
const DROP = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "head", "title", "meta", "link"])
const RENAME: Record<string, string> = { h1: "h2", h5: "h4", h6: "h4", div: "p" }

const escapeText = (s: string) => s.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

function safeHref(href: string | undefined) {
  const v = (href ?? "").trim()
  return /^(https?:\/\/|mailto:)/i.test(v) ? v : null
}

function render(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) return escapeText(node.rawText)
  if (node.nodeType !== NodeType.ELEMENT_NODE) return ""
  const el = node as HTMLElement
  const raw = el.rawTagName?.toLowerCase() ?? ""
  if (DROP.has(raw)) return ""
  const inner = el.childNodes.map(render).join("")
  const tag = RENAME[raw] ?? raw
  if (!ALLOWED.has(tag)) return inner
  if (tag === "br") return "<br>"
  if (tag === "a") {
    const href = safeHref(el.getAttribute("href"))
    return href ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>` : inner
  }
  return `<${tag}>${inner}</${tag}>`
}

export function sanitizeRichText(html: string): string {
  return parse(html, { comment: false })
    .childNodes.map(render)
    .join("")
    .replace(/<p>(?:\s|<br>)*<\/p>/g, "")
    .trim()
}

/** Rich-text HTML as plain text with paragraph breaks (used to copy approved content into a draft). */
export function richTextToText(html: string): string {
  const blocks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, "\n\n")
  return parse(blocks)
    .textContent.replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Visible text of rich-text HTML (used to require non-empty content). */
export function richTextToPlain(html: string): string {
  return parse(html).textContent.replace(/ /g, " ").replace(/\s+/g, " ").trim()
}
