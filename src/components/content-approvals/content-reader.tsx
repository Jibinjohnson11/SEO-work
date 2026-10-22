import { ToneBadge } from "@/components/shared/status-badge"
import { RICH_TEXT_CLASS } from "@/components/shared/rich-text-editor"
import { CONTENT_STATUS, CONTENT_TYPES, DECISION_LABEL, DECISION_TONE, type ContentStatus, type ContentType } from "@/lib/offpage-content"
import { formatDateTime } from "@/lib/format"
import { sanitizeRichText } from "@/lib/rich-text"
import { cn } from "@/lib/utils"

/** One piece of Off-Page Content as the Content Approvals pages show it (client portal and Super Admin). */
export interface ReviewContent {
  id: string
  code: string
  status: ContentStatus
  title: string
  content_html: string
  content_type: ContentType
  current_version: number
  approved_version: number | null
  submitted_at: string
  brand: string
  campaign: { code: string; name: string }
  keyword: string
  backlink_type: string
  versions: { version: number; title: string; content_html: string; created_at: string }[]
  decisions: { version: number; decision: keyof typeof DECISION_LABEL; feedback: string | null; decided_by_name: string; created_at: string; is_admin_override?: boolean }[]
}

/** Comfortable long-form reading: a narrow column, larger type and generous spacing. */
const ARTICLE_CLASS = cn(
  RICH_TEXT_CLASS,
  "text-[15px] leading-7 sm:text-base sm:leading-8 [overflow-wrap:anywhere] [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:text-xl [&_h3]:mt-6 [&_h3]:text-lg [&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-md [&_p]:my-4 [&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1",
)

/** The complete submitted content (current version) with its title and campaign details. Never truncated. */
export function ContentArticle({ content, tz }: { content: ReviewContent; tz: string }) {
  const st = CONTENT_STATUS[content.status]
  return (
    <article className="surface overflow-hidden">
      <header className="space-y-3 border-b bg-muted/30 px-5 py-5 sm:px-10 sm:py-7">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
          <span>{content.code}</span>
          <span aria-hidden>·</span>
          <span>Version {content.current_version}</span>
          {content.approved_version ? (
            <>
              <span aria-hidden>·</span>
              <span>Approved version {content.approved_version}</span>
            </>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{content.title}</h1>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Brand", content.brand],
            ["Campaign", `${content.campaign.name} (${content.campaign.code})`],
            ["Target keyword", content.keyword],
            ["Content type", CONTENT_TYPES[content.content_type]],
            ["Backlink type", content.backlink_type],
            ["Submitted", formatDateTime(content.submitted_at, tz)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
              <dd className="mt-0.5 [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <div className="px-5 py-6 sm:px-10 sm:py-8">
        <div className={cn(ARTICLE_CLASS, "mx-auto max-w-[72ch]")} dangerouslySetInnerHTML={{ __html: sanitizeRichText(content.content_html) }} />
      </div>
    </article>
  )
}

/** Every client decision and every submitted version; nothing is overwritten when content is revised. */
export function ContentHistory({ content, tz }: { content: ReviewContent; tz: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="surface">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Review history</h2>
          <p className="text-xs text-muted-foreground">Every decision, with the version it applied to</p>
        </header>
        <div className="p-4">
          {content.decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No review decisions yet.</p>
          ) : (
            <ol className="space-y-3 text-sm">
              {content.decisions.map((x, i) => (
                <li key={i} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ToneBadge tone={DECISION_TONE[x.decision]}>{DECISION_LABEL[x.decision]}</ToneBadge>
                    <span className="font-medium">{x.decided_by_name}</span>
                    {x.is_admin_override ? <ToneBadge tone="warning">Admin override</ToneBadge> : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Version {x.version} · {formatDateTime(x.created_at, tz)}</div>
                  {x.feedback ? <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{x.feedback}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
      <section className="surface">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Versions</h2>
          <p className="text-xs text-muted-foreground">Each submission is kept as its own version</p>
        </header>
        <ul className="divide-y text-sm">
          {content.versions.map((v) => {
            const decided = content.decisions.filter((d) => d.version === v.version)
            return (
              <li key={v.version}>
                <details className="group">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 hover:bg-muted/40">
                    <span className="font-medium">Version {v.version}</span>
                    {v.version === content.current_version ? <ToneBadge tone="info">Current</ToneBadge> : null}
                    {decided.map((d, i) => <ToneBadge key={i} tone={DECISION_TONE[d.decision]}>{DECISION_LABEL[d.decision]}</ToneBadge>)}
                    <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(v.created_at, tz)}</span>
                  </summary>
                  <div className="space-y-2 border-t bg-muted/20 px-4 py-4">
                    <p className="font-medium">{v.title}</p>
                    <div className={cn(RICH_TEXT_CLASS, "[overflow-wrap:anywhere]")} dangerouslySetInnerHTML={{ __html: sanitizeRichText(v.content_html) }} />
                  </div>
                </details>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
