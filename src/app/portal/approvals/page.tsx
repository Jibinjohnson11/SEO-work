import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { StatCard } from "@/components/shared/stat-card"
import { SubmissionStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { LinkButton } from "@/components/ui/link-button"
import { formatDateTime } from "@/lib/format"
import { param, type SearchParams } from "@/server/queries"
import { portalClients, portalSubmissions } from "@/server/portal"
import { CONTENT_STATUS, CONTENT_TYPES, type ContentStatus, type ContentType } from "@/lib/offpage-content"

interface PortalContentRow {
  id: string
  code: string
  client_id: string
  campaign_code: string
  campaign_name: string
  keyword: string
  backlink_type: string
  content_type: ContentType
  title: string
  status: ContentStatus
  current_version: number
  approved_version: number | null
  submitted_at: string
  author_name: string | null
}

export const metadata = { title: "Content Approvals" }

// The database functions return only the signed-in client's own brands, so every count and list here
// is already brand-scoped.
export default async function PortalApprovals({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["client"], "portal.approvals")
  const status = param(sp, "status") in CONTENT_STATUS ? (param(sp, "status") as ContentStatus) : null
  const brand = param(sp, "brand")
  const allPlacements = param(sp, "placements") === "all"
  const [clients, subs, contentRes] = await Promise.all([
    portalClients(supabase),
    portalSubmissions(supabase, !allPlacements),
    supabase.rpc("client_portal_offpage_contents", { p_queue_only: false }),
  ])
  if (contentRes.error) throw contentRes.error
  const brandName = Object.fromEntries(clients.map((c) => [c.id, c.company_name]))
  const all = ((contentRes.data ?? []) as PortalContentRow[]).filter((c) => !brand || c.client_id === brand)
  const contents = status ? all.filter((c) => c.status === status) : all
  const count = (s: ContentStatus) => all.filter((c) => c.status === s).length
  const tz = clients[0]?.timezone ?? "UTC"
  const href = (s: ContentStatus) => `?${new URLSearchParams({ ...(brand ? { brand } : {}), status: s })}`

  return (
    <>
      <PageHeader title="Content Approvals" description="Read the content our SEO team has written for your campaigns and approve it, reject it or ask for edits." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pending Review" value={count("awaiting_client_approval")} tone={count("awaiting_client_approval") ? "warning" : "default"} href={href("awaiting_client_approval")} />
        <StatCard label="Approved" value={count("approved")} tone="success" href={href("approved")} />
        <StatCard label="Needs Edit" value={count("changes_requested")} href={href("changes_requested")} />
        <StatCard label="Rejected" value={count("rejected")} tone={count("rejected") ? "danger" : "default"} href={href("rejected")} />
      </div>
      <FilterBar
        filters={[
          { type: "select", key: "status", label: "Status", allLabel: "All statuses", options: (Object.keys(CONTENT_STATUS) as ContentStatus[]).map((s) => ({ value: s, label: CONTENT_STATUS[s].label })) },
          ...(clients.length > 1 ? [{ type: "select" as const, key: "brand", label: "Brand", allLabel: "All brands", options: clients.map((c) => ({ value: c.id, label: c.company_name })) }] : []),
          { type: "select", key: "placements", label: "Placements", allLabel: "Placements awaiting approval", options: [{ value: "all", label: "All placements shared with me" }] },
        ]}
      />
      <DataTable cards={{ title: "item", badge: "status", actions: "view", storageKey: "content" }}
        searchPlaceholder="Search title, campaign, keyword…"
        columns={[
          { key: "item", header: "Content", sortable: true },
          { key: "brand", header: "Brand", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "keyword", header: "Target keyword", sortable: true },
          { key: "type", header: "Content type", sortable: true },
          { key: "sent", header: "Submitted", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "view", header: "", className: "w-32" },
        ]}
        rows={contents.map((c) => ({
          id: c.id,
          search: `${c.code} ${c.title} ${c.campaign_name} ${c.keyword} ${brandName[c.client_id] ?? ""}`,
          sort: { item: c.title, brand: brandName[c.client_id] ?? "", campaign: c.campaign_name, keyword: c.keyword, type: CONTENT_TYPES[c.content_type], sent: c.submitted_at, status: CONTENT_STATUS[c.status].label },
          cells: {
            item: <Link href={`/portal/approvals/content/${c.id}`} className="group block max-w-80"><span className="font-medium group-hover:text-primary">{c.title}</span><span className="block truncate text-xs text-muted-foreground">{c.code} · version {c.current_version}{c.author_name ? ` · ${c.author_name}` : ""}</span></Link>,
            brand: brandName[c.client_id] ?? "—",
            campaign: <span>{c.campaign_name}<span className="block text-xs text-muted-foreground">{c.campaign_code}</span></span>,
            keyword: c.keyword,
            type: CONTENT_TYPES[c.content_type],
            sent: formatDateTime(c.submitted_at, tz),
            status: <ToneBadge tone={CONTENT_STATUS[c.status].tone}>{CONTENT_STATUS[c.status].label}</ToneBadge>,
            view: (
              <LinkButton href={`/portal/approvals/content/${c.id}`} variant={c.status === "awaiting_client_approval" ? "default" : "outline"}>
                {c.status === "awaiting_client_approval" ? "Review content" : "View content"}
              </LinkButton>
            ),
          },
        }))}
        empty={{ title: status === "awaiting_client_approval" ? "No content waiting for your review" : "No content yet", description: "You'll be notified when new content is ready for review." }}
      />

      <div className="pt-2">
        <h2 className="text-sm font-semibold">{allPlacements ? "Backlink placements" : "Backlink placements awaiting approval"}</h2>
        <p className="text-xs text-muted-foreground">Proposed websites for publishing your backlinks</p>
      </div>
      <DataTable cards={{ title: "item", badge: "status" }}
        searchPlaceholder="Search title, website, campaign…"
        columns={[
          { key: "item", header: "Content / placement", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "type", header: "Backlink type", sortable: true },
          { key: "keyword", header: "Keyword" },
          { key: "sent", header: "Sent for approval", sortable: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={subs.map((s) => ({
          id: s.id,
          href: `/portal/approvals/${s.id}`,
          search: `${s.code} ${s.content_title ?? ""} ${s.proposed_website} ${s.campaign_name} ${s.keyword ?? ""}`,
          sort: { item: s.content_title ?? s.proposed_website, campaign: s.campaign_code, type: s.backlink_type, sent: s.sent_to_client_at, status: s.status },
          cells: {
            item: <Link href={`/portal/approvals/${s.id}`} className="group block max-w-80"><span className="font-medium group-hover:text-primary">{s.content_title ?? s.proposed_website}</span><span className="block truncate text-xs text-muted-foreground">{s.code} · {s.proposed_website}</span></Link>,
            campaign: <span>{s.campaign_name}<span className="block text-xs text-muted-foreground">{s.campaign_code}</span></span>,
            type: s.backlink_type,
            keyword: s.keyword,
            sent: formatDateTime(s.sent_to_client_at, tz),
            status: s.status === "awaiting_client_approval" && s.client_approved_version ? <span className="flex flex-col gap-1"><SubmissionStatusBadge status={s.status} /><ToneBadge tone="warning">Revised after approval</ToneBadge></span> : <SubmissionStatusBadge status={s.status} />,
          },
        }))}
        empty={{ title: allPlacements ? "No placements shared yet" : "No placements awaiting your approval", description: "You'll be notified when a placement is ready." }}
      />
    </>
  )
}
