import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { StatCard } from "@/components/shared/stat-card"
import { ToneBadge } from "@/components/shared/status-badge"
import { LinkButton } from "@/components/ui/link-button"
import { formatDateTime } from "@/lib/format"
import { humanize } from "@/lib/workflow"
import { CONTENT_STATUS, CONTENT_TYPES, DECISION_LABEL, DECISION_TONE, type ContentDecision, type ContentStatus, type OffpageContent } from "@/lib/offpage-content"
import { getLookups, getPresets, getSetting, labelMaps, param, type SearchParams } from "@/server/queries"
import { querySubmissions, SUBMISSION_COLUMNS, submissionFilters, submissionRows } from "@/server/submission-list"
import type { ClientApproval } from "@/lib/types"

export const metadata = { title: "Content Approvals" }

type ContentRow = Pick<OffpageContent, "id" | "code" | "title" | "client_id" | "campaign_id" | "keyword_id" | "content_type" | "status" | "current_version" | "approved_version" | "submitted_at">

// Off-Page Content as clients review it, the decisions they made, and (below) backlink placements
// awaiting the client. Only client decisions are shown as approvals; admin overrides are labelled as such.
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports, presets] = await Promise.all([getLookups(supabase), getSetting("reports"), getPresets(supabase, "/admin/approvals")])
  const client = /^[0-9a-f-]{36}$/.test(param(sp, "client")) ? param(sp, "client") : ""
  // "content" filters the content list; "status" belongs to the backlink placement filters below.
  const status = param(sp, "content") in CONTENT_STATUS ? (param(sp, "content") as ContentStatus) : null
  const statuses = ["awaiting_client_approval", "client_changes_requested", "client_approved", "client_rejected"] as const
  const subs = await querySubmissions(supabase, sp, { statuses: [...statuses], timeZone: reports.timezone })
  let dq = supabase.from("client_approvals").select("*, backlink_submissions(code, campaign_id)").order("created_at", { ascending: false }).limit(300)
  if (client) dq = dq.eq("client_id", client)
  let cq = supabase.from("offpage_contents").select("id, code, title, client_id, campaign_id, keyword_id, content_type, status, current_version, approved_version, submitted_at").order("submitted_at", { ascending: false }).limit(1000)
  if (client) cq = cq.eq("client_id", client)
  let cdq = supabase.from("offpage_content_decisions").select("content_id, version, decision, feedback, decided_by_name, created_at, is_admin_override").order("created_at", { ascending: false }).limit(300)
  if (client) cdq = cdq.eq("client_id", client)
  // Exact per-status counts (the list itself shows the 1,000 most recent).
  const countOf = (s: ContentStatus) => {
    let q = supabase.from("offpage_contents").select("id", { count: "exact", head: true }).eq("status", s)
    if (client) q = q.eq("client_id", client)
    return q
  }
  const [{ data: decisions }, { data: contentData }, { data: contentDecisionData }, ...counts] = await Promise.all([
    dq, cq, cdq, ...(Object.keys(CONTENT_STATUS) as ContentStatus[]).map(countOf),
  ])
  const statusCount = Object.fromEntries((Object.keys(CONTENT_STATUS) as ContentStatus[]).map((s, i) => [s, counts[i].count ?? 0])) as Record<ContentStatus, number>
  const allContent = (contentData ?? []) as ContentRow[]
  const contents = status ? allContent.filter((c) => c.status === status) : allContent
  const contentDecisions = (contentDecisionData ?? []) as ContentDecision[]
  const contentById = new Map(allContent.map((c) => [c.id, c]))
  const labels = labelMaps(lookups)
  const count = (s: ContentStatus) => statusCount[s]
  const href = (s: ContentStatus) => `?${new URLSearchParams({ ...(client ? { client } : {}), content: s })}`
  const tz = reports.timezone
  return (
    <>
      <PageHeader title="Content Approvals" description="Off-Page Content sent to clients for review, their decisions and feedback. A backlink submission that links approved content skips the placement's client approval." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pending Review" value={count("awaiting_client_approval")} href={href("awaiting_client_approval")} />
        <StatCard label="Approved" value={count("approved")} tone="success" href={href("approved")} />
        <StatCard label="Needs Edit" value={count("changes_requested")} tone={count("changes_requested") ? "warning" : "default"} href={href("changes_requested")} />
        <StatCard label="Rejected" value={count("rejected")} tone={count("rejected") ? "danger" : "default"} href={href("rejected")} />
      </div>
      <FilterBar
        filters={[
          { type: "select", key: "content", label: "Review status", allLabel: "All statuses", options: (Object.keys(CONTENT_STATUS) as ContentStatus[]).map((s) => ({ value: s, label: CONTENT_STATUS[s].label })) },
          { type: "select", key: "client", label: "Brand", allLabel: "All brands", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
        ]}
        presets={presets}
      />
      <DataTable cards={{ title: "item", badge: "status", actions: "view", storageKey: "content" }}
        searchPlaceholder="Search title, brand, campaign, keyword…"
        columns={[
          { key: "item", header: "Content", sortable: true },
          { key: "brand", header: "Brand", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "keyword", header: "Target keyword", sortable: true },
          { key: "type", header: "Content type", sortable: true },
          { key: "sent", header: "Submitted", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "view", header: "", className: "w-28" },
        ]}
        rows={contents.map((c) => ({
          id: c.id,
          search: `${c.code} ${c.title} ${labels.client[c.client_id] ?? ""} ${labels.campaignName[c.campaign_id] ?? ""} ${labels.keyword[c.keyword_id] ?? ""}`,
          sort: { item: c.title, brand: labels.client[c.client_id] ?? "", campaign: labels.campaignName[c.campaign_id] ?? "", keyword: labels.keyword[c.keyword_id] ?? "", type: CONTENT_TYPES[c.content_type], sent: c.submitted_at, status: CONTENT_STATUS[c.status].label },
          cells: {
            item: <Link href={`/admin/approvals/content/${c.id}`} className="group block max-w-80"><span className="font-medium group-hover:text-primary">{c.title}</span><span className="block truncate text-xs text-muted-foreground">{c.code} · v{c.current_version}{c.approved_version ? ` · approved v${c.approved_version}` : ""}</span></Link>,
            brand: labels.client[c.client_id] ?? "—",
            campaign: labels.campaignName[c.campaign_id] ?? "—",
            keyword: labels.keyword[c.keyword_id] ?? "—",
            type: CONTENT_TYPES[c.content_type],
            sent: formatDateTime(c.submitted_at, tz),
            status: <ToneBadge tone={CONTENT_STATUS[c.status].tone}>{CONTENT_STATUS[c.status].label}</ToneBadge>,
            view: <LinkButton href={`/admin/approvals/content/${c.id}`} variant="outline">View content</LinkButton>,
          },
        }))}
        empty={{ title: status ? `No content with status “${CONTENT_STATUS[status].label}”` : "No content sent for review yet", description: "Content created in Off-Page Content goes straight to the client for review.", action: <LinkButton href="/admin/page-content" variant="outline">Open Off-Page Content</LinkButton> }}
      />
      {allContent.length >= 1000 ? <p className="text-xs text-muted-foreground">Showing the 1,000 most recently submitted. Filter by brand or status to see older content.</p> : null}
      <Section title="Content review log" description="Most recent 300 client decisions on content, with feedback" bodyClassName="p-0">
        <DataTable
          searchPlaceholder="Search decisions…"
          pageSize={15}
          columns={[
            { key: "when", header: "When", sortable: true },
            { key: "content", header: "Content", sortable: true },
            { key: "client", header: "Brand", sortable: true },
            { key: "by", header: "Reviewed by", sortable: true },
            { key: "decision", header: "Decision", sortable: true },
            { key: "version", header: "Version", align: "right" },
            { key: "feedback", header: "Feedback" },
          ]}
          rows={contentDecisions.map((d, i) => {
            const c = contentById.get(d.content_id)
            return {
              id: `${d.content_id}:${i}`,
              search: `${c?.code ?? ""} ${c?.title ?? ""} ${d.decided_by_name} ${d.feedback ?? ""} ${c ? labels.client[c.client_id] ?? "" : ""}`,
              sort: { when: d.created_at, content: c?.title ?? "", client: c ? labels.client[c.client_id] ?? "" : "", by: d.decided_by_name, decision: DECISION_LABEL[d.decision] },
              cells: {
                when: formatDateTime(d.created_at, tz),
                content: <Link href={`/admin/approvals/content/${d.content_id}`} className="block max-w-64 truncate font-medium hover:text-primary">{c ? `${c.code} · ${c.title}` : "Content"}</Link>,
                client: c ? labels.client[c.client_id] : "—",
                by: d.decided_by_name,
                decision: d.is_admin_override ? <ToneBadge tone="warning">Admin override · {DECISION_LABEL[d.decision]}</ToneBadge> : <ToneBadge tone={DECISION_TONE[d.decision]}>{DECISION_LABEL[d.decision]}</ToneBadge>,
                version: `v${d.version}`,
                feedback: <span className="line-clamp-2 max-w-80 text-xs">{d.feedback}</span>,
              },
            }
          })}
          empty={{ title: "No content decisions yet" }}
        />
      </Section>

      <div className="pt-2">
        <h2 className="text-sm font-semibold">Backlink placements with clients</h2>
        <p className="text-xs text-muted-foreground">Backlink submissions awaiting or decided by the client</p>
      </div>
      <FilterBar filters={submissionFilters(lookups, { statuses: [...statuses], withPeriod: false })} />
      <DataTable cards={{ title: "code", badge: "status" }} searchPlaceholder={false} columns={SUBMISSION_COLUMNS} rows={submissionRows(subs, lookups, tz)} empty={{ title: "Nothing with clients right now" }} />
      <Section title="Placement decision log" description="Most recent 300 client decisions and admin overrides on backlink submissions" bodyClassName="p-0">
        <DataTable
          searchPlaceholder="Search decisions…"
          pageSize={15}
          columns={[
            { key: "when", header: "When", sortable: true },
            { key: "submission", header: "Submission", sortable: true },
            { key: "client", header: "Brand", sortable: true },
            { key: "by", header: "Decided by", sortable: true },
            { key: "decision", header: "Decision", sortable: true },
            { key: "version", header: "Version", align: "right" },
            { key: "feedback", header: "Feedback" },
          ]}
          rows={((decisions ?? []) as (ClientApproval & { backlink_submissions: { code: string; campaign_id: string } })[]).map((a) => ({
            id: a.id,
            search: `${a.backlink_submissions.code} ${a.decided_by_name} ${a.feedback ?? ""} ${labels.client[a.client_id] ?? ""}`,
            sort: { when: a.created_at, submission: a.backlink_submissions.code, client: labels.client[a.client_id], by: a.decided_by_name, decision: a.decision },
            cells: {
              when: formatDateTime(a.created_at, tz),
              submission: <Link href={`/admin/submissions/${a.submission_id}`} className="font-medium hover:text-primary">{a.backlink_submissions.code}</Link>,
              client: labels.client[a.client_id],
              by: a.decided_by_name,
              decision: a.is_admin_override ? <ToneBadge tone="warning">Admin override</ToneBadge> : <ToneBadge tone={a.decision === "approved" ? "success" : a.decision === "rejected" ? "danger" : "warning"}>{humanize(a.decision)}</ToneBadge>,
              version: `v${a.version}`,
              feedback: <span className="line-clamp-2 max-w-80 text-xs">{a.feedback}</span>,
            },
          }))}
          empty={{ title: "No client decisions yet" }}
        />
      </Section>
    </>
  )
}
