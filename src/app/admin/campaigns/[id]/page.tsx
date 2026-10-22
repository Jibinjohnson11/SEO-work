import Link from "next/link"
import { notFound } from "next/navigation"
import { Copy, History, Pencil } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { KeywordDetailsButton } from "@/components/admin/keyword-details"
import { DetailList, PageHeader, Section } from "@/components/shared/page-header"
import { ProgressBar, StatCard } from "@/components/shared/stat-card"
import { CampaignStatusBadge, PriorityBadge, SubmissionStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { DataTable } from "@/components/shared/data-table"
import { CampaignFormButton } from "@/components/admin/campaign-form"
import { CampaignRowActions } from "@/components/admin/campaign-actions"
import { TimeSeriesChart } from "@/components/charts/charts"
import { ConfirmAction } from "@/components/shared/confirm-action"
import { addDays, buildReport, dailySeries, monthStart, todayIn, weekStart } from "@/lib/reporting"
import { formatDay, formatDateTime } from "@/lib/format"
import { humanize, SUBMISSION_STATUS } from "@/lib/workflow"
import { duplicateCampaign } from "@/server/admin/campaigns"
import { getCampaignFormOptions } from "@/server/campaign-options"
import { fetchAll, getSetting, labelMaps, getLookups } from "@/server/queries"
import { loadReportData } from "@/server/report-data"
import type { ActivityLog, Campaign, Submission, SubmissionStatus } from "@/lib/types"

export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireRole(["super_admin"])
  const { data } = await supabase.from("campaigns").select("*, clients(id, company_name, timezone, is_medical, require_client_approval)").eq("id", id).maybeSingle()
  if (!data) notFound()
  const c = data as Campaign & { clients: { id: string; company_name: string; timezone: string; is_medical: boolean; require_client_approval: boolean } }
  const tz = c.clients.timezone
  const today = todayIn(tz)
  const from30 = addDays(today, -29)
  const [options, kw, assigned, types, subs, published, general, lookups, activity, audit] = await Promise.all([
    getCampaignFormOptions(supabase),
    supabase.from("campaign_keywords").select("keyword_id, is_primary, keywords(keyword, target_url, search_intent)").eq("campaign_id", id),
    supabase.from("intern_assignments").select("intern_id, is_active, profiles!intern_id(full_name, email)").eq("campaign_id", id),
    supabase.from("campaign_backlink_types").select("backlink_type_id, backlink_types(name)").eq("campaign_id", id),
    supabase.from("backlink_submissions").select("*", { count: "exact" }).eq("campaign_id", id).order("updated_at", { ascending: false }).limit(500),
    fetchAll<{ live_status: string }>((a, b) => supabase.from("published_backlinks").select("live_status").eq("campaign_id", id).order("id").range(a, b)),
    getSetting("general"),
    getLookups(supabase),
    loadReportData(supabase, { from: from30, to: today, timeZone: tz, filters: { campaign: id } }),
    supabase.from("activity_logs").select("*").eq("entity_type", "campaigns").eq("entity_id", id).order("created_at", { ascending: false }).limit(10),
  ])
  const labels = labelMaps(lookups)
  const keywords = (kw.data ?? []) as unknown as { keyword_id: string; is_primary: boolean; keywords: { keyword: string; target_url: string | null; search_intent: string | null } }[]
  const interns = (assigned.data ?? []) as unknown as { intern_id: string; is_active: boolean; profiles: { full_name: string; email: string } }[]
  const allowed = (types.data ?? []) as unknown as { backlink_type_id: string; backlink_types: { name: string } }[]
  const submissions = (subs.data ?? []) as Submission[]

  const period = (from: string) => buildReport({ ...activity, from, to: today, timeZone: tz, groupBy: [] }).totals
  const t = { day: period(today), week: period(weekStart(today) < from30 ? from30 : weekStart(today)), month: period(monthStart(today) < from30 ? from30 : monthStart(today)) }
  const byIntern = buildReport({ ...activity, from: monthStart(today) < from30 ? from30 : monthStart(today), to: today, timeZone: tz, groupBy: ["intern"], labels }).rows
  const statusCounts = submissions.reduce<Partial<Record<SubmissionStatus, number>>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {})
  const live = published.filter((p) => p.live_status === "live" || p.live_status === "changed").length
  const auditLogs = (audit.data ?? []) as ActivityLog[]
  const people = [...new Set([c.created_by, ...auditLogs.map((l) => l.actor_id)].filter((v): v is string => Boolean(v)))]
  const { data: profiles } = people.length ? await supabase.from("profiles").select("id, full_name, email").in("id", people) : { data: [] }
  const actorName = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]))
  const createdBy = c.created_by ? actorName.get(c.created_by) : null
  const flag = (v: boolean | null, inherited: boolean) => (v === null ? `${inherited ? "Yes" : "No"} (brand default)` : v ? "Yes" : "No")

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.code} · {c.name} <CampaignStatusBadge status={c.status} /> <PriorityBadge priority={c.priority} />
          </span>
        }
        description={<Link href={`/admin/clients/${c.clients.id}`} className="hover:text-primary">{c.clients.company_name}</Link>}
        actions={
          <>
            <CampaignFormButton
              campaign={c}
              options={options}
              variant="outline"
              relations={{
                primary_keyword: keywords.find((k) => k.is_primary)?.keywords.keyword ?? "",
                secondary_keywords: keywords.filter((k) => !k.is_primary).map((k) => k.keywords.keyword),
                intern_ids: interns.filter((i) => i.is_active).map((i) => i.intern_id),
                backlink_type_ids: allowed.map((a) => a.backlink_type_id),
              }}
            >
              <Pencil /> Edit
            </CampaignFormButton>
            <ConfirmAction title="Duplicate this campaign?" description="Creates a draft copy with the same keywords, team members, types and targets." onConfirm={duplicateCampaign.bind(null, c.id)}>
              <Copy /> Duplicate
            </ConfirmAction>
            <CampaignRowActions id={c.id} status={c.status} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Submitted today" value={t.day.submitted} hint={c.daily_target ? `Target ${c.daily_target}` : undefined} />
        <StatCard label="Submitted this week" value={t.week.submitted} hint={c.weekly_target ? `Target ${c.weekly_target}` : undefined} />
        <StatCard label="Awaiting client" value={statusCounts.awaiting_client_approval ?? 0} href={`/admin/approvals?campaign=${c.id}`} />
        <StatCard label="Published this month" value={t.month.published} />
        <StatCard label="Verified live this month" value={t.month.verified_live} tone="success" hint={c.monthly_target ? `of ${c.monthly_target} target` : undefined} />
        <StatCard label="Published backlinks (all time)" value={published.length} hint={`${live} currently live`} href={`/admin/published?campaign=${c.id}`} />
        <StatCard label="Submissions (all time)" value={subs.count ?? submissions.length} href={`/admin/submissions?campaign=${c.id}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Targets" description="Verified live backlinks against targets">
          <div className="space-y-3 text-sm">
            <div><div className="mb-1 flex justify-between"><span>Today</span><span className="tabular text-muted-foreground">{t.day.verified_live} / {c.daily_target}</span></div><ProgressBar value={t.day.verified_live} max={c.daily_target} /></div>
            <div><div className="mb-1 flex justify-between"><span>This week</span><span className="tabular text-muted-foreground">{t.week.verified_live} / {c.weekly_target}</span></div><ProgressBar value={t.week.verified_live} max={c.weekly_target} /></div>
            <div><div className="mb-1 flex justify-between"><span>This month</span><span className="tabular text-muted-foreground">{t.month.verified_live} / {c.monthly_target}</span></div><ProgressBar value={t.month.verified_live} max={c.monthly_target} /></div>
          </div>
        </Section>
        <Section title="Campaign overview" className="lg:col-span-2">
          <DetailList
            items={[
              { label: "Code", value: c.code },
              { label: "Brand", value: <Link href={`/admin/clients/${c.clients.id}`} className="text-primary hover:underline">{c.clients.company_name}</Link> },
              { label: "Target URL", value: c.target_url ? <a className="text-primary hover:underline" href={c.target_url} target="_blank" rel="noreferrer noopener">{c.target_url}</a> : "—" },
              { label: "Target location", value: c.target_location ?? "—" },
              { label: "Dates", value: `${formatDay(c.start_date, general.date_format)} → ${formatDay(c.end_date, general.date_format)}` },
              { label: "Medical review", value: flag(c.is_medical, c.clients.is_medical) },
              { label: "Internal review", value: (c.is_medical ?? c.clients.is_medical) ? "Yes (medical review)" : "No (client approval only)" },
              { label: "Client approval", value: flag(c.require_client_approval, c.clients.require_client_approval) },
              { label: "Allowed backlink types", value: allowed.length ? allowed.map((a) => a.backlink_types.name).join(", ") : "All active types" },
              { label: "Description", value: c.description ?? "—" },
              { label: "Internal notes", value: c.internal_notes ?? "—" },
              { label: "Created", value: `${formatDateTime(c.created_at, tz)}${createdBy ? ` by ${createdBy}` : ""}` },
              { label: "Last updated", value: formatDateTime(c.updated_at, tz) },
            ]}
          />
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Keywords" bodyClassName="p-0">
          {keywords.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No keywords assigned.</p> : (
            <ul>
              {keywords.sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).map((k) => (
                <li key={k.keyword_id} className="flex items-center justify-between gap-2 border-b px-4 py-2 text-sm last:border-0">
                  <span>{k.keywords.keyword} {k.is_primary ? <ToneBadge tone="info">Primary</ToneBadge> : null}</span>
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-xs text-muted-foreground">{[k.keywords.target_url, k.keywords.search_intent && humanize(k.keywords.search_intent)].filter(Boolean).join(" · ")}</span>
                    <KeywordDetailsButton keywordId={k.keyword_id} campaignId={c.id} keyword={k.keywords.keyword} initial={k.keywords} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Assigned Team Members" description="This month" bodyClassName="p-0">
          {interns.filter((i) => i.is_active).length === 0 ? <p className="p-4 text-sm text-muted-foreground">No interns assigned.</p> : (
            <ul>
              {interns.filter((i) => i.is_active).map((i) => {
                const r = byIntern.find((x) => x.dims.intern?.id === i.intern_id)
                return (
                  <li key={i.intern_id} className="flex items-center justify-between gap-2 border-b px-4 py-2 text-sm last:border-0">
                    <Link href={`/admin/interns/${i.intern_id}`} className="hover:text-primary">{i.profiles.full_name || i.profiles.email}</Link>
                    <span className="tabular text-xs text-muted-foreground">{r?.submitted ?? 0} submitted · {r?.client_approved ?? 0} approved · {r?.verified_live ?? 0} live</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>

      <TimeSeriesChart
        title="Last 30 days"
        data={dailySeries(activity.events, from30, today, tz)}
        series={[
          { key: "submitted", label: "Submitted", slot: 1 },
          { key: "client_approved", label: "Client approved", slot: 3 },
          { key: "published", label: "Published", slot: 4 },
          { key: "verified_live", label: "Verified live", slot: 6 },
        ]}
      />

      <Section title="Approval status" description="Current status of all submissions for this campaign">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(statusCounts) as SubmissionStatus[]).map((s) => (
            <Link key={s} href={`/admin/submissions?campaign=${c.id}&status=${s}`} className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              <span className="tabular font-semibold">{statusCounts[s]}</span> <span className="text-muted-foreground">{SUBMISSION_STATUS[s].label}</span>
            </Link>
          ))}
          {submissions.length === 0 ? <p className="text-sm text-muted-foreground">No submissions yet.</p> : null}
        </div>
      </Section>

      <Section
        title="Audit history"
        description="Latest changes to this campaign"
        bodyClassName="p-0"
        actions={
          <Link href={`/admin/activity?entity=campaigns&q=${c.id}`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10">
            <History className="size-3.5" aria-hidden /> Full audit trail
          </Link>
        }
      >
        {auditLogs.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No recorded changes yet.</p> : (
          <ul>
            {auditLogs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm last:border-0">
                <span className="min-w-0">
                  <ToneBadge tone={l.action === "delete" ? "danger" : "neutral"}>{l.action}</ToneBadge> <span className="[overflow-wrap:anywhere]">{l.summary ?? ""}</span>
                </span>
                <span className="tabular text-xs text-muted-foreground">{l.actor_id && actorName.has(l.actor_id) ? `${actorName.get(l.actor_id)} · ` : ""}{formatDateTime(l.created_at, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <DataTable
        caption="Recent submissions"
        searchPlaceholder="Search submissions…"
        pageSize={10}
        columns={[
          { key: "code", header: "Submission", sortable: true },
          { key: "website", header: "Proposed website", sortable: true },
          { key: "type", header: "Type", sortable: true },
          { key: "intern", header: "Team member", sortable: true },
          { key: "updated", header: "Updated", sortable: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={submissions.map((s) => ({
          id: s.id,
          search: `${s.code} ${s.proposed_website} ${s.content_title ?? ""} ${s.anchor_text ?? ""}`,
          sort: { code: s.code, website: s.proposed_domain, type: labels.backlink_type[s.backlink_type_id], intern: labels.intern[s.intern_id], updated: s.updated_at, status: s.status },
          cells: {
            code: <Link href={`/admin/submissions/${s.id}`} className="font-medium hover:text-primary">{s.code}</Link>,
            website: <span className="block max-w-56 truncate">{s.proposed_domain}<span className="block truncate text-xs text-muted-foreground">{s.content_title}</span></span>,
            type: labels.backlink_type[s.backlink_type_id],
            intern: labels.intern[s.intern_id],
            updated: formatDateTime(s.updated_at, tz),
            status: <SubmissionStatusBadge status={s.status} />,
          },
        }))}
        empty={{ title: "No submissions yet" }}
      />
    </>
  )
}
