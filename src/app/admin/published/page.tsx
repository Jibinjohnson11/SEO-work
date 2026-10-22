import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { StatCard } from "@/components/shared/stat-card"
import { LiveStatusBadge } from "@/components/shared/status-badge"
import { VerifyBulk } from "@/components/submissions/verification-controls"
import { formatDateTime, formatDay } from "@/lib/format"
import { LIVE_STATUS } from "@/lib/workflow"
import { getLookups, getPresets, getSetting, labelMaps, type SearchParams } from "@/server/queries"
import { queryPublished } from "@/server/published-list"
import type { LiveStatus } from "@/lib/types"

export const metadata = { title: "Published Backlinks" }

export default async function PublishedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports, general, presets, rows] = await Promise.all([getLookups(supabase), getSetting("reports"), getSetting("general"), getPresets(supabase, "/admin/published"), queryPublished(supabase, sp)])
  const l = labelMaps(lookups)
  const count = (s: LiveStatus) => rows.filter((r) => r.live_status === s).length
  return (
    <>
      <PageHeader title="Published Backlinks" description="Placements recorded as published. A placement only counts as a live backlink after verification." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(Object.keys(LIVE_STATUS) as LiveStatus[]).map((s) => <StatCard key={s} label={LIVE_STATUS[s].label} value={count(s)} tone={s === "live" ? "success" : s === "missing" || s === "unreachable" ? "danger" : s === "changed" ? "warning" : "default"} href={`/admin/published?live=${s}`} />)}
      </div>
      <FilterBar
        presets={presets}
        filters={[
          { type: "search", key: "q", label: "Search", placeholder: "URL, domain, anchor, SUB code" },
          { type: "select", key: "live", label: "Live status", options: (Object.keys(LIVE_STATUS) as LiveStatus[]).map((s) => ({ value: s, label: LIVE_STATUS[s].label })) },
          { type: "select", key: "client", label: "Brand", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
          { type: "select", key: "campaign", label: "Campaign", options: lookups.campaigns.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })) },
          { type: "select", key: "intern", label: "Team member", options: lookups.interns.map((i) => ({ value: i.id, label: i.full_name || i.email })) },
          { type: "select", key: "type", label: "Backlink type", options: lookups.types.map((t) => ({ value: t.id, label: t.name })) },
        ]}
      />
      <DataTable cards={{ title: "url", badge: "status" }}
        searchPlaceholder={false}
        bulk={<VerifyBulk />}
        columns={[
          { key: "url", header: "Published URL", sortable: true },
          { key: "submission", header: "Submission", sortable: true },
          { key: "campaign", header: "Campaign", sortable: true },
          { key: "type", header: "Type", sortable: true },
          { key: "intern", header: "Team member", sortable: true },
          { key: "anchor", header: "Anchor / attribute" },
          { key: "date", header: "Published", sortable: true },
          { key: "checked", header: "Last checked", sortable: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={rows.map((p) => ({
          id: p.id,
          href: `/admin/submissions/${p.submission_id}`,
          sort: { url: p.publisher_domain, submission: p.backlink_submissions.code, campaign: l.campaign[p.campaign_id], type: l.backlink_type[p.backlink_type_id], intern: l.intern[p.intern_id], date: p.publication_date, checked: p.last_checked_at, status: p.live_status },
          cells: {
            url: <a href={p.published_url} target="_blank" rel="noreferrer noopener nofollow" className="block max-w-72 truncate text-primary hover:underline">{p.published_url}</a>,
            submission: <Link href={`/admin/submissions/${p.submission_id}`} className="font-medium hover:text-primary">{p.backlink_submissions.code}</Link>,
            campaign: l.campaign[p.campaign_id],
            type: l.backlink_type[p.backlink_type_id],
            intern: l.intern[p.intern_id],
            anchor: <span className="text-xs">{p.anchor_text ?? "—"}<span className="block text-muted-foreground">{p.link_attribute}</span></span>,
            date: formatDay(p.publication_date, general.date_format),
            checked: formatDateTime(p.last_checked_at, reports.timezone),
            status: <LiveStatusBadge status={p.live_status} />,
          },
        }))}
        empty={{ title: "Nothing published yet", description: "Approved submissions appear here once their live URL is recorded." }}
      />
    </>
  )
}
