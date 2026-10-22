import Link from "next/link"
import {
  AlertTriangle,
  BadgeCheck,
  Clock,
  FileQuestion,
  Gauge,
  Globe,
  Link2,
  Megaphone,
  MessageSquareWarning,
  PlusCircle,
  Radar,
  SearchX,
  XCircle,
} from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { ProgressBar, StatCard } from "@/components/shared/stat-card"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterBar, type FilterDef } from "@/components/shared/filter-bar"
import { CategoryBarChart, CumulativeChart, StackedDailyChart, type Series } from "@/components/charts/charts"
import { buildReport, eachDay, localDate, utcRange } from "@/lib/reporting"
import { formatDay, formatNumber } from "@/lib/format"
import { teamRoleLabel } from "@/lib/team"
import type { LiveStatus } from "@/lib/types"
import { fetchAll, getLookups, getPresets, getSetting, labelMaps, resolvePeriod, type SearchParams } from "@/server/queries"
import { loadReportData, readFilters } from "@/server/report-data"
import { completionRate } from "@/server/unified-report"

export const metadata = { title: "SEO Dashboard" }

// SEO analytics dashboard. Every number comes from stored records:
//   * published_backlinks — one row per placement (page → target), so revisions never double-count;
//     "recorded" = created_at (when publication was recorded), "verified" = first_verified_live_at /
//     live_status, both set only by verification checks.
//   * report_events / tasks — the same first-occurrence milestones and targets as the Reports page.
//   * offpage_contents — Off-Page Content client approval status.
// Totals are "as of the end of the selected range"; "added" metrics and charts use the range itself.

interface PublishedRow {
  id: string
  client_id: string
  campaign_id: string
  intern_id: string
  backlink_type_id: string
  publisher_domain: string
  live_status: LiveStatus
  created_at: string
  first_verified_live_at: string | null
  backlink_submissions: { domain_authority: number | null } | null
}

const PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["last_7", "Last 7 days"],
  ["last_30", "Last 30 days"],
  ["this_month", "This month"],
  ["last_month", "Last month"],
  ["this_year", "This year"],
  ["custom", "Custom range"],
] as const

const MAX_MEMBER_SERIES = 5

export default async function AdminOverview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [lookups, reportSettings, presets] = await Promise.all([getLookups(supabase), getSetting("reports"), getPresets(supabase, "/admin")])
  const filters = readFilters(sp)
  const tz = reportSettings.timezone
  const period = resolvePeriod(sp, tz, "last_30")
  const { start, end } = utcRange(period.from, period.to, tz)
  const labels = labelMaps(lookups)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = (q: any, internCol = "intern_id") => {
    let r = q
    if (filters.client) r = r.eq("client_id", filters.client)
    if (filters.campaign) r = r.eq("campaign_id", filters.campaign)
    if (filters.intern) r = r.eq(internCol, filters.intern)
    if (filters.type) r = r.eq("backlink_type_id", filters.type)
    return r
  }

  const head = { count: "exact" as const, head: true }
  const [published, rangeData, contentRes, roles, awaitingClient, inReview] = await Promise.all([
    fetchAll<PublishedRow>((a, b) =>
      scoped(
        supabase
          .from("published_backlinks")
          .select("id, client_id, campaign_id, intern_id, backlink_type_id, publisher_domain, live_status, created_at, first_verified_live_at, backlink_submissions(domain_authority)"),
      )
        .lt("created_at", end.toISOString())
        .order("created_at")
        .range(a, b),
    ),
    loadReportData(supabase, { from: period.from, to: period.to, timeZone: tz, filters }),
    // Paged past the 1,000-row API limit; a failed read hides the content panel instead of breaking the page.
    fetchAll<{ status: string }>((a, b) => scoped(supabase.from("offpage_contents").select("status"), "submitted_by").lt("created_at", end.toISOString()).order("id").range(a, b))
      .then((data) => ({ data, error: null }), (error: unknown) => ({ data: null, error })),
    supabase.from("profiles").select("id, job_title").eq("role", "intern"),
    scoped(supabase.from("backlink_submissions").select("id", head)).eq("status", "awaiting_client_approval"),
    scoped(supabase.from("backlink_submissions").select("id", head)).in("status", ["submitted", "internal_review"]),
  ])

  // ---- KPIs (as of range end) ------------------------------------------------------------------
  const inRange = (iso: string | null) => !!iso && iso >= start.toISOString() && iso < end.toISOString()
  const domains = new Set(published.map((p) => p.publisher_domain))
  const daValues = published.map((p) => p.backlink_submissions?.domain_authority).filter((v): v is number => v !== null && v !== undefined)
  const avgDa = daValues.length ? Math.round((daValues.reduce((a, b) => a + Number(b), 0) / daValues.length) * 10) / 10 : null
  const added = published.filter((p) => inRange(p.created_at))
  const liveNow = published.filter((p) => p.live_status === "live").length
  const activeCampaigns = lookups.campaigns.filter((c) => c.status === "active" && (!filters.client || c.client_id === filters.client) && (!filters.campaign || c.id === filters.campaign)).length

  // ---- Backlinks added per day, stacked by team member ----------------------------------------
  const days = eachDay(period.from, period.to)
  const memberTotals = new Map<string, number>()
  for (const p of added) memberTotals.set(p.intern_id, (memberTotals.get(p.intern_id) ?? 0) + 1)
  const ranked = [...memberTotals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  const shown = ranked.slice(0, ranked.length > MAX_MEMBER_SERIES + 1 ? MAX_MEMBER_SERIES : MAX_MEMBER_SERIES + 1)
  const hasOther = ranked.length > shown.length
  // Color follows the member (ordered by name), not their rank this period.
  const memberSeries: Series[] = [...shown]
    .sort((a, b) => (labels.intern[a] ?? "").localeCompare(labels.intern[b] ?? ""))
    .map((id, i) => ({ key: `m_${id}`, label: labels.intern[id] ?? "Unknown", slot: i + 1 }))
  if (hasOther) memberSeries.push({ key: "other", label: `Other (${ranked.length - shown.length})`, slot: "reference" })
  const perDay = new Map(days.map((d) => [d, { date: d } as { date: string } & Record<string, number | string>]))
  for (const p of added) {
    const row = perDay.get(localDate(p.created_at, tz))
    if (!row) continue
    const key = shown.includes(p.intern_id) ? `m_${p.intern_id}` : "other"
    row[key] = Number(row[key] ?? 0) + 1
  }
  const dailyData = [...perDay.values()].map((r) => ({ ...Object.fromEntries(memberSeries.map((s) => [s.key, 0])), ...r }))

  // ---- Cumulative published vs. verified live ---------------------------------------------------
  const startIso = start.toISOString()
  const pubBase = published.filter((p) => p.created_at < startIso).length
  const verBase = published.filter((p) => p.first_verified_live_at && p.first_verified_live_at < startIso).length
  const pubByDay = new Map<string, number>()
  const verByDay = new Map<string, number>()
  for (const p of published) {
    if (inRange(p.created_at)) pubByDay.set(localDate(p.created_at, tz), (pubByDay.get(localDate(p.created_at, tz)) ?? 0) + 1)
    if (inRange(p.first_verified_live_at)) verByDay.set(localDate(p.first_verified_live_at!, tz), (verByDay.get(localDate(p.first_verified_live_at!, tz)) ?? 0) + 1)
  }
  const cumulative = days.reduce<{ date: string; published: number; verified: number }[]>((acc, d) => {
    const prev = acc.at(-1) ?? { published: pubBase, verified: verBase }
    acc.push({ date: d, published: prev.published + (pubByDay.get(d) ?? 0), verified: prev.verified + (verByDay.get(d) ?? 0) })
    return acc
  }, [])

  // ---- By type and top domains -------------------------------------------------------------------
  const byTypeMap = new Map<string, number>()
  for (const p of published) byTypeMap.set(p.backlink_type_id, (byTypeMap.get(p.backlink_type_id) ?? 0) + 1)
  const byType = [...byTypeMap.entries()].map(([id, n]) => ({ name: labels.backlink_type[id] ?? "Unknown", backlinks: n })).sort((a, b) => b.backlinks - a.backlinks)
  const domainMap = new Map<string, { backlinks: number; campaigns: Set<string> }>()
  for (const p of published) {
    const d = domainMap.get(p.publisher_domain) ?? { backlinks: 0, campaigns: new Set<string>() }
    d.backlinks += 1
    d.campaigns.add(p.campaign_id)
    domainMap.set(p.publisher_domain, d)
  }
  const topDomains = [...domainMap.entries()]
    .map(([name, d]) => ({ name, backlinks: d.backlinks, campaigns: d.campaigns.size }))
    .sort((a, b) => b.backlinks - a.backlinks || a.name.localeCompare(b.name))
    .slice(0, 10)

  // ---- Campaigns and team (same engine as Reports: first-occurrence events + task targets) -------
  const campaignRows = buildReport({ ...rangeData, from: period.from, to: period.to, timeZone: tz, groupBy: ["campaign"], labels }).rows
  const campaignClient = new Map(lookups.campaigns.map((c) => [c.id, c.client_id]))
  const topCampaigns = campaignRows
    .filter((r) => r.target || r.submitted || r.published || r.verified_live)
    .sort((a, b) => b.published - a.published || b.verified_live - a.verified_live || b.submitted - a.submitted)
    .slice(0, 10)
  const internRows = new Map(buildReport({ ...rangeData, from: period.from, to: period.to, timeZone: tz, groupBy: ["intern"], labels }).rows.map((r) => [r.dims.intern!.id, r]))
  const roleOf = new Map((roles.data ?? []).map((r) => [r.id as string, teamRoleLabel(r.job_title as string | null)]))
  const team = lookups.interns
    .filter((i) => (i.status === "active" || internRows.has(i.id)) && (!filters.intern || i.id === filters.intern))
    .map((i) => {
      const r = internRows.get(i.id)
      const m = { target: r?.target ?? 0, submitted: r?.submitted ?? 0, published: r?.published ?? 0, verified: r?.verified_live ?? 0 }
      return { id: i.id, name: i.full_name || i.email, role: roleOf.get(i.id) ?? "Intern", ...m, completion: completionRate(m.submitted, m.target) }
    })
    .sort((a, b) => b.published - a.published || b.submitted - a.submitted || a.name.localeCompare(b.name))

  // ---- Off-Page Content approvals and backlink health -------------------------------------------
  const contentAvailable = !contentRes.error
  const contentCount = (s: string) => ((contentRes.data ?? []) as { status: string }[]).filter((c) => c.status === s).length
  const health = (statuses: LiveStatus[]) => published.filter((p) => statuses.includes(p.live_status)).length

  const filterDefs: FilterDef[] = [
    { type: "period", presets: PRESETS.map(([value, label]) => ({ value, label })) },
    { type: "select", key: "client", label: "Brand", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
    { type: "select", key: "campaign", label: "Campaign", options: lookups.campaigns.filter((c) => !filters.client || c.client_id === filters.client).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })) },
    { type: "select", key: "intern", label: "Team member", options: lookups.interns.map((i) => ({ value: i.id, label: i.full_name || i.email })) },
    { type: "select", key: "type", label: "Backlink type", options: lookups.types.map((t) => ({ value: t.id, label: t.name })) },
  ]
  const rangeLabel = period.from === period.to ? formatDay(period.from) : `${formatDay(period.from)} – ${formatDay(period.to)}`
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`)
  const th = "px-4 py-2 font-medium whitespace-nowrap"
  const td = "px-4 py-2"

  return (
    <>
      <PageHeader title="SEO Dashboard" description={`${rangeLabel} · ${tz} · totals are as of the end of the range`} />
      <FilterBar filters={filterDefs} presets={presets} defaultPeriod="last_30" />
      {(awaitingClient.count ?? 0) > 0 || (inReview.count ?? 0) > 0 ? (
        <p className="surface flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
          <span className="font-medium">Needs attention now:</span>
          {(awaitingClient.count ?? 0) > 0 ? <Link href="/admin/approvals" className="text-primary hover:underline">{awaitingClient.count} backlink submission{awaitingClient.count === 1 ? "" : "s"} awaiting client approval</Link> : null}
          {(inReview.count ?? 0) > 0 ? <Link href="/admin/review" className="text-primary hover:underline">{inReview.count} awaiting medical review</Link> : null}
        </p>
      ) : null}

      {/* 1. KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total Backlinks" value={formatNumber(published.length)} icon={Link2} href="/admin/published" info="Published backlinks recorded up to the end of the range. One placement (page → target) is one backlink, however often its submission was revised." />
        <StatCard label="Unique Referring Domains" value={formatNumber(domains.size)} icon={Globe} info="Distinct publisher domains among those backlinks, normalized (lower-case, without www.)." />
        <StatCard label="Active Campaigns" value={formatNumber(activeCampaigns)} icon={Megaphone} href="/admin/campaigns?status=active" info="Campaigns currently marked active, within the brand / campaign filter." />
        <StatCard
          label="Average Domain Authority"
          value={avgDa === null ? "Not available" : avgDa}
          icon={Gauge}
          hint={avgDa === null ? "No DA recorded" : `From ${daValues.length} of ${published.length} backlinks`}
          info="Average of the Domain Authority entered on the submissions behind these backlinks (a third-party estimate recorded by the team). Backlinks without a DA value are left out."
        />
        <StatCard label="Backlinks Added" value={formatNumber(added.length)} icon={PlusCircle} hint={rangeLabel} info="Backlinks whose publication was recorded within the selected range (in the reporting time zone)." />
        <StatCard label="Verified Live Backlinks" value={formatNumber(liveNow)} icon={Radar} tone="success" href="/admin/verification" info="Backlinks whose latest verification check found the link live. Submitting a URL never counts as verified." />
      </div>

      {/* 2. Backlinks added per day */}
      <StackedDailyChart
        title="Backlinks Added Per Day"
        description="Publications recorded per day, by team member (click a name to hide or show it). Submissions are not included."
        data={dailyData}
        series={memberSeries}
      />

      {/* 3. Cumulative + by type */}
      <div className="grid gap-6 lg:grid-cols-2">
        <CumulativeChart
          title="Cumulative Backlinks"
          description="Running total of published backlinks and of those verified live at least once"
          data={cumulative}
          series={[
            { key: "published", label: "Published", slot: 1 },
            { key: "verified", label: "Verified live", slot: 6 },
          ]}
        />
        <CategoryBarChart title="Backlinks by Type" description="Published backlinks by configured backlink type" data={byType} categoryLabel="Backlink type" series={[{ key: "backlinks", label: "Backlinks", slot: 1 }]} />
      </div>

      {/* 4. Top domains + top campaigns */}
      <div className="grid gap-6 lg:grid-cols-2">
        <CategoryBarChart
          title="Top Referring Domains"
          description="Top 10 publisher domains by backlinks, with the number of campaigns they serve"
          data={topDomains}
          categoryLabel="Domain"
          series={[
            { key: "backlinks", label: "Backlinks", slot: 1 },
            { key: "campaigns", label: "Campaigns", slot: "reference" },
          ]}
        />
        <Section title="Top Campaigns" description="By backlinks published in the range · completion = submitted ÷ assigned target" bodyClassName="p-0">
          {topCampaigns.length === 0 ? (
            <EmptyState title="No campaign activity in this range" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className={`${th} text-left`}>Campaign</th>
                    <th scope="col" className={`${th} text-right`}>Target</th>
                    <th scope="col" className={`${th} text-right`}>Published</th>
                    <th scope="col" className={`${th} text-right`}>Verified</th>
                    <th scope="col" className={`${th} w-36 text-left`}>Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {topCampaigns.map((r) => {
                    const id = r.dims.campaign!.id
                    return (
                      <tr key={id} className="border-b last:border-0">
                        <td className={`${td} max-w-56`}>
                          <Link href={`/admin/campaigns/${id}`} className="block truncate font-medium hover:text-primary" title={labels.campaignName[id]}>{labels.campaignName[id] ?? r.dims.campaign!.label}</Link>
                          <span className="block truncate text-xs text-muted-foreground">{labels.client[campaignClient.get(id) ?? ""] ?? "—"}</span>
                        </td>
                        <td className={`${td} tabular text-right`}>{r.target}</td>
                        <td className={`${td} tabular text-right`}>{r.published}</td>
                        <td className={`${td} tabular text-right`}>{r.verified_live}</td>
                        <td className={td}>{r.target ? <ProgressBar value={r.submitted} max={r.target} /> : <span className="text-xs text-muted-foreground">No target</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {/* 5. Team performance */}
      <Section title="Team Performance" description="Every team member (interns, students, faculty and other roles) · completion = submitted ÷ assigned target" bodyClassName="p-0">
        {team.length === 0 ? (
          <EmptyState title="No team members" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className={`${th} text-left`}>Team member</th>
                  <th scope="col" className={`${th} text-right`}>Assigned target</th>
                  <th scope="col" className={`${th} text-right`}>Submitted</th>
                  <th scope="col" className={`${th} text-right`}>Published</th>
                  <th scope="col" className={`${th} text-right`}>Verified</th>
                  <th scope="col" className={`${th} w-44 text-left`}>Completion rate</th>
                </tr>
              </thead>
              <tbody>
                {team.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className={td}>
                      <Link href={`/admin/interns/${m.id}`} className="font-medium hover:text-primary">{m.name}</Link>
                      <span className="block text-xs text-muted-foreground">{m.role}</span>
                    </td>
                    <td className={`${td} tabular text-right`}>{m.target}</td>
                    <td className={`${td} tabular text-right`}>{m.submitted}</td>
                    <td className={`${td} tabular text-right`}>{m.published}</td>
                    <td className={`${td} tabular text-right`}>{m.verified}</td>
                    <td className={td}>{m.target ? <ProgressBar value={m.submitted} max={m.target} /> : <span className="text-xs text-muted-foreground" title={pct(m.completion)}>No target</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 6. Content approvals (Off-Page Content) */}
      <Section title="Content Approvals" description="Off-Page Content by current client review status (content created up to the end of the range)">
        {contentAvailable ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Pending Review" value={contentCount("awaiting_client_approval")} icon={Clock} tone={contentCount("awaiting_client_approval") ? "warning" : "default"} href="/admin/approvals?content=awaiting_client_approval" />
            <StatCard label="Approved" value={contentCount("approved")} icon={BadgeCheck} tone="success" href="/admin/approvals?content=approved" />
            <StatCard label="Needs Edit" value={contentCount("changes_requested")} icon={MessageSquareWarning} tone={contentCount("changes_requested") ? "warning" : "default"} href="/admin/approvals?content=changes_requested" />
            <StatCard label="Rejected" value={contentCount("rejected")} icon={XCircle} tone={contentCount("rejected") ? "danger" : "default"} href="/admin/approvals?content=rejected" />
          </div>
        ) : (
          <EmptyState icon={FileQuestion} title="Content approval data is not available yet" description="The Off-Page Content tables have not been set up in this database." />
        )}
      </Section>

      {/* 7. Backlink health */}
      <Section title="Backlink Health" description="Latest verification result of each backlink (up to the end of the range). Only verification checks set these statuses.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Verified Live" value={health(["live"])} icon={Radar} tone="success" href="/admin/verification" info="Link found on the page at the latest check." />
          <StatCard label="Awaiting Verification" value={health(["pending_verification"])} icon={Clock} href="/admin/verification" info="Published, not checked yet." />
          <StatCard label="Broken Links" value={health(["unreachable", "changed"])} icon={AlertTriangle} tone={health(["unreachable", "changed"]) ? "danger" : "default"} href="/admin/verification" info="Page could not be loaded (unreachable), or the link was found but its attributes changed." />
          <StatCard label="Missing Backlinks" value={health(["missing"])} icon={SearchX} tone={health(["missing"]) ? "danger" : "default"} href="/admin/verification" info="Page loaded but the link to the target was not found." />
        </div>
      </Section>
    </>
  )
}
