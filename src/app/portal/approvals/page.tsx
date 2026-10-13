import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { SubmissionStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { formatDateTime } from "@/lib/format"
import { param, type SearchParams } from "@/server/queries"
import { portalClients, portalSubmissions } from "@/server/portal"

export const metadata = { title: "Approvals" }

export default async function PortalApprovals({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["client"], "portal.approvals")
  const view = param(sp, "view") || "queue"
  const [clients, subs] = await Promise.all([portalClients(supabase), portalSubmissions(supabase, view === "queue")])
  const tz = clients[0]?.timezone ?? "UTC"
  return (
    <>
      <PageHeader title="Approvals" description="Review proposed placements and content. Your decision applies to the exact version you see." />
      <FilterBar filters={[{ type: "select", key: "view", label: "Show", allLabel: "Awaiting my approval", options: [{ value: "all", label: "All items shared with me" }] }]} />
      <DataTable
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
        empty={{ title: view === "queue" ? "Nothing awaiting your approval" : "Nothing shared yet", description: "You'll be notified when new content is ready." }}
      />
    </>
  )
}
