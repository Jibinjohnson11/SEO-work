import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { StatCard } from "@/components/shared/stat-card"
import { LiveStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { ManualVerifyButton, VerifyBulk, VerifyNowButton } from "@/components/submissions/verification-controls"
import { formatDateTime } from "@/lib/format"
import { LIVE_STATUS } from "@/lib/workflow"
import { getLookups, getSetting, hoursAgo, labelMaps, type SearchParams } from "@/server/queries"
import { queryPublished } from "@/server/published-list"
import type { LiveStatus, VerificationCheck } from "@/lib/types"

export const metadata = { title: "Backlink Verification" }

export default async function VerificationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reports, settings, rows, recent] = await Promise.all([
    getLookups(supabase),
    getSetting("reports"),
    getSetting("verification"),
    queryPublished(supabase, sp, { liveStatuses: ["pending_verification", "missing", "unreachable", "changed"] }),
    supabase.from("verification_checks").select("*, published_backlinks(published_url, submission_id)").order("checked_at", { ascending: false }).limit(50),
  ])
  const l = labelMaps(lookups)
  const tz = reports.timezone
  const { count: dueCount } = await supabase.from("published_backlinks").select("id", { count: "exact", head: true }).or(`last_checked_at.is.null,last_checked_at.lt.${hoursAgo(settings.recheck_interval_hours)}`)
  const count = (s: LiveStatus) => rows.filter((r) => r.live_status === s).length
  const checks = (recent.data ?? []) as (VerificationCheck & { published_backlinks: { published_url: string; submission_id: string } })[]

  return (
    <>
      <PageHeader
        title="Backlink Verification"
        description={`Automated checks fetch the page server-side (respecting robots.txt${settings.respect_robots ? "" : " — currently OFF"}, ${settings.timeout_ms / 1000}s timeout, ${settings.per_domain_delay_ms / 1000}s per-domain delay) and confirm the target URL is present as a link. Re-check every ${settings.recheck_interval_hours}h ${settings.auto_verify ? "via the scheduled job" : "(scheduled checks disabled)"}.`}
        actions={<VerifyNowButton ids={rows.filter((r) => r.live_status === "pending_verification").slice(0, 25).map((r) => r.id)} label="Check pending (max 25)" />}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Pending verification" value={count("pending_verification")} tone="warning" href="/admin/verification?live=pending_verification" />
        <StatCard label="Changed" value={count("changed")} tone="warning" href="/admin/verification?live=changed" />
        <StatCard label="Missing" value={count("missing")} tone="danger" href="/admin/verification?live=missing" />
        <StatCard label="Unreachable" value={count("unreachable")} tone="danger" href="/admin/verification?live=unreachable" />
        <StatCard label="Due for re-check" value={dueCount ?? 0} hint={`Not checked in ${settings.recheck_interval_hours}h`} />
      </div>
      <FilterBar
        filters={[
          { type: "search", key: "q", label: "Search", placeholder: "URL, domain, SUB code" },
          { type: "select", key: "live", label: "Live status", allLabel: "Needs attention", options: (Object.keys(LIVE_STATUS) as LiveStatus[]).map((s) => ({ value: s, label: LIVE_STATUS[s].label })) },
          { type: "select", key: "client", label: "Brand", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
          { type: "select", key: "campaign", label: "Campaign", options: lookups.campaigns.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })) },
        ]}
      />
      <DataTable cards={{ title: "url", badge: "status", actions: "actions" }}
        searchPlaceholder={false}
        bulk={<VerifyBulk />}
        columns={[
          { key: "url", header: "Published URL", sortable: true },
          { key: "target", header: "Target URL" },
          { key: "submission", header: "Submission", sortable: true },
          { key: "checked", header: "Last checked", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "actions", header: "" },
        ]}
        rows={rows.map((p) => ({
          id: p.id,
          href: `/admin/submissions/${p.submission_id}`,
          sort: { url: p.publisher_domain, submission: p.backlink_submissions.code, checked: p.last_checked_at, status: p.live_status },
          cells: {
            url: <a href={p.published_url} target="_blank" rel="noreferrer noopener nofollow" className="block max-w-72 truncate text-primary hover:underline">{p.published_url}</a>,
            target: <span className="block max-w-56 truncate text-xs">{p.target_url}</span>,
            submission: <Link href={`/admin/submissions/${p.submission_id}`} className="font-medium hover:text-primary">{p.backlink_submissions.code}<span className="block text-xs font-normal text-muted-foreground">{l.campaign[p.campaign_id]}</span></Link>,
            checked: formatDateTime(p.last_checked_at, tz),
            status: <LiveStatusBadge status={p.live_status} />,
            actions: <span className="flex justify-end gap-1"><VerifyNowButton ids={[p.id]} label="Check" size="xs" /><ManualVerifyButton publishedId={p.id} size="xs" /></span>,
          },
        }))}
        empty={{ title: "Nothing needs attention", description: "All published backlinks are verified live." }}
      />
      <Section title="Recent checks" bodyClassName="p-0">
        <DataTable
          searchPlaceholder={false}
          pageSize={10}
          columns={[{ key: "when", header: "Checked", sortable: true }, { key: "url", header: "URL" }, { key: "method", header: "Method" }, { key: "result", header: "Result", sortable: true }, { key: "http", header: "HTTP", align: "right" }, { key: "detail", header: "Detail" }]}
          rows={checks.map((c) => ({
            id: c.id,
            sort: { when: c.checked_at, result: c.result },
            cells: {
              when: formatDateTime(c.checked_at, tz),
              url: <Link href={`/admin/submissions/${c.published_backlinks.submission_id}`} className="block max-w-64 truncate hover:text-primary">{c.published_backlinks.published_url}</Link>,
              method: c.method,
              result: <ToneBadge tone={c.result === "live" ? "success" : c.result === "changed" || c.result === "inconclusive" ? "warning" : "danger"}>{c.result}</ToneBadge>,
              http: c.http_status ?? "—",
              detail: <span className="line-clamp-2 max-w-80 text-xs text-muted-foreground">{c.error ?? c.notes ?? (c.found_anchor_text ? `Anchor: ${c.found_anchor_text}` : "")}</span>,
            },
          }))}
          empty={{ title: "No checks yet" }}
        />
      </Section>
    </>
  )
}
