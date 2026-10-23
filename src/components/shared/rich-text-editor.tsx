"use client"

import { useEffect, useRef } from "react"
import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Pilcrow, Unlink } from "lucide-react"
import { cn } from "@/lib/utils"
import { sanitizeRichText } from "@/lib/rich-text"

/** Typography for rich-text HTML, shared by the editor and read-only views. */
export const RICH_TEXT_CLASS =
  "text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&>:first-child]:mt-0"

const TOOLS = [
  { label: "Heading", icon: Heading2, run: () => document.execCommand("formatBlock", false, "h2") },
  { label: "Subheading", icon: Heading3, run: () => document.execCommand("formatBlock", false, "h3") },
  { label: "Paragraph", icon: Pilcrow, run: () => document.execCommand("formatBlock", false, "p") },
  { label: "Bold", icon: Bold, run: () => document.execCommand("bold") },
  { label: "Italic", icon: Italic, run: () => document.execCommand("italic") },
  { label: "Bulleted list", icon: List, run: () => document.execCommand("insertUnorderedList") },
  { label: "Numbered list", icon: ListOrdered, run: () => document.execCommand("insertOrderedList") },
  {
    label: "Add link",
    icon: Link2,
    run: () => {
      const url = window.prompt("Link URL (https://…)")?.trim()
      if (url && /^(https?:\/\/|mailto:)/i.test(url)) document.execCommand("createLink", false, url)
    },
  },
  { label: "Remove link", icon: Unlink, run: () => document.execCommand("unlink") },
]

/**
 * Minimal rich-text editor (headings, paragraphs, lists, links). Pasted HTML is cleaned with the
 * same allow-list the server applies on save, so what you see is what gets stored.
 */
export function RichTextEditor({
  id,
  value,
  onChange,
  invalid,
  placeholder = "Write or paste your content…",
}: {
  id?: string
  value: string
  onChange: (html: string) => void
  invalid?: boolean
  placeholder?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Only push external values in (initial value, form reset); typing is never overwritten.
  // Stored content is sanitized before it reaches the DOM: it may have been saved without the server action.
  useEffect(() => {
    const el = ref.current
    if (el && el.innerHTML !== value && document.activeElement !== el) el.innerHTML = sanitizeRichText(value)
  }, [value])

  const emit = () => onChange(ref.current?.innerHTML ?? "")

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-transparent focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        invalid && "border-destructive ring-destructive/20",
      )}
    >
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-0.5 border-b bg-muted/40 p-1">
        {TOOLS.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.label}
            aria-label={t.label}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            // Keep the selection in the editor while clicking the toolbar.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              ref.current?.focus()
              t.run()
              emit()
            }}
          >
            <t.icon className="size-4" />
          </button>
        ))}
      </div>
      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-invalid={invalid || undefined}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className={cn(
          RICH_TEXT_CLASS,
          "max-h-[28rem] min-h-56 overflow-y-auto px-3 py-2 outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        )}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          const html = e.clipboardData.getData("text/html")
          if (!html) return
          e.preventDefault()
          document.execCommand("insertHTML", false, sanitizeRichText(html))
          emit()
        }}
      />
    </div>
  )
}
