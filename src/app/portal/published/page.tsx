import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { EmptyState } from "@/components/shared/empty-state"
import { LiveStatusBadge } from "@/components/shared/status-badge"
import { formatDateTime, formatDay } from "@/lib/format"
import { portalClients, portalPublished } from "@/server/portal"

export const metadata = { title: "Published Backlinks" }

export default async function PortalPublished() {
  const { supabase } = await requireRole(["client"], "portal.published")
  const clients = await portalClients(supabase)
  if (!clients.some((c) => c.settings.show_published_backlinks)) return <EmptyState title="Not available" description="Your agency has not enabled this view for your workspace." />
  const rows = await portalPublished(supabase)
  const tz = clients[0]?.timezone ?? "UTC"
  return (
    <>
      <PageHeader title="Published Backlinks" description="Live placements and their latest verification. “Live” means our system confirmed the link to your page is present." />
      <DataTable
        searchPlaceholder="Search URL, campaign…"
        columns={[
          { key: "url", header: "Published URL", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "type", header: "Type", sortable: true },
          { key: "target", header: "Links to" },
          { key: "anchor", header: "Anchor / attribute" },
          { key: "date", header: "Published", sortable: true },
          { key: "status", header: "Verification", sortable: true },
        ]}
        rows={rows.map((p) => ({
          id: p.id,
          search: `${p.published_url} ${p.campaign_name} ${p.anchor_text ?? ""}`,
          sort: { url: p.publisher_domain, campaign: p.campaign_code, type: p.backlink_type, date: p.publication_date, status: p.live_status },
          cells: {
            url: <a href={p.published_url} target="_blank" rel="noreferrer noopener nofollow" className="block max-w-72 truncate text-primary hover:underline">{p.published_url}</a>,
            campaign: p.campaign_name,
            type: p.backlink_type,
            target: <span className="block max-w-56 truncate text-xs">{p.target_url}</span>,
            anchor: <span className="text-xs">{p.anchor_text ?? "—"}<span className="block text-muted-foreground">{p.link_attribute}</span></span>,
            date: formatDay(p.publication_date),
            status: <span className="flex flex-col gap-0.5"><LiveStatusBadge status={p.live_status} /><span className="text-[11px] text-muted-foreground">{formatDateTime(p.last_checked_at, tz)}</span></span>,
          },
        }))}
        empty={{ title: "No published backlinks yet" }}
      />
    </>
  )
}
