import Link from "next/link"
import { UserPlus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { ToneBadge } from "@/components/shared/status-badge"
import { ProgressBar } from "@/components/shared/stat-card"
import { InviteUserButton } from "@/components/admin/invite-user"
import { UserMenu } from "@/components/admin/user-actions"
import { formatDay } from "@/lib/format"
import { getLookups, getSetting, param, resolvePeriod, type SearchParams } from "@/server/queries"
import { internMetrics } from "@/server/intern-metrics"
import type { Profile } from "@/lib/types"

export const metadata = { title: "Interns" }

export default async function InternsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [reports, defaults, general, lookups] = await Promise.all([getSetting("reports"), getSetting("campaign_defaults"), getSetting("general"), getLookups(supabase)])
  const period = resolvePeriod(sp, reports.timezone, "this_month")
  const status = param(sp, "status")
  let q = supabase.from("profiles").select("*").eq("role", "intern").order("full_name")
  if (status) q = q.eq("status", status)
  const [{ data }, assignments, metrics] = await Promise.all([
    q,
    supabase.from("intern_assignments").select("intern_id, campaign_id").eq("is_active", true),
    internMetrics(supabase, { from: period.from, to: period.to, timeZone: reports.timezone }),
  ])
  const interns = (data ?? []) as Profile[]
  const campaignOptions = lookups.campaigns.filter((c) => c.status !== "archived").map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))
  const assignedTo = (id: string) => (assignments.data ?? []).filter((a) => a.intern_id === id).map((a) => a.campaign_id)

  return (
    <>
      <PageHeader
        title="Interns"
        description={`Performance for ${period.from === period.to ? formatDay(period.from) : `${formatDay(period.from)} – ${formatDay(period.to)}`} — based on approved and verified outcomes, not only volume.`}
        actions={
          <InviteUserButton role="intern" campaigns={campaignOptions} defaults={defaults}>
            <UserPlus /> Invite intern
          </InviteUserButton>
        }
      />
      <FilterBar
        defaultPeriod="this_month"
        filters={[
          { type: "period" },
          { type: "select", key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "invited", label: "Invited" }, { value: "disabled", label: "Disabled" }] },
        ]}
      />
      <DataTable
        searchPlaceholder="Search interns…"
        columns={[
          { key: "name", header: "Intern", sortable: true },
          { key: "campaigns", header: "Campaigns", sortable: true, align: "right" },
          { key: "tasks", header: "Open tasks", sortable: true, align: "right" },
          { key: "targets", header: "Daily / weekly target" },
          { key: "submitted", header: "Submitted", sortable: true, align: "right" },
          { key: "approved", header: "Client approved", sortable: true, align: "right" },
          { key: "live", header: "Verified live", sortable: true, align: "right" },
          { key: "revision", header: "Revision rate", sortable: true, align: "right" },
          { key: "completion", header: "Target completion", sortable: true, className: "w-40" },
          { key: "status", header: "Status", sortable: true },
          { key: "actions", header: "", className: "w-10" },
        ]}
        rows={interns.map((p) => {
          const m = metrics.get(p.id)
          const camps = assignedTo(p.id)
          return {
            id: p.id,
            search: `${p.full_name} ${p.email} ${p.job_title ?? ""}`,
            sort: { name: p.full_name || p.email, campaigns: camps.length, tasks: m?.open_tasks ?? 0, submitted: m?.submitted ?? 0, approved: m?.client_approved ?? 0, live: m?.verified_live ?? 0, revision: m?.revision_rate ?? 0, completion: m?.target_completion ?? 0, status: p.status },
            cells: {
              name: (
                <Link href={`/admin/interns/${p.id}`} className="group block">
                  <span className="font-medium group-hover:text-primary">{p.full_name || p.email}</span>
                  <span className="block text-xs text-muted-foreground">{p.email}{p.joining_date ? ` · joined ${formatDay(p.joining_date, general.date_format)}` : ""}</span>
                </Link>
              ),
              campaigns: camps.length,
              tasks: m?.open_tasks ?? 0,
              targets: <span className="tabular text-xs">{p.daily_target} / {p.weekly_target}</span>,
              submitted: m?.submitted ?? 0,
              approved: m?.client_approved ?? 0,
              live: m?.verified_live ?? 0,
              revision: `${m?.revision_rate ?? 0}%`,
              completion: <ProgressBar value={m?.submitted ?? 0} max={m?.target ?? 0} />,
              status: <ToneBadge tone={p.status === "active" ? "success" : p.status === "invited" ? "info" : "muted"}>{p.status}</ToneBadge>,
              actions: <UserMenu user={p} intern={{ profile: p, campaignIds: camps, campaigns: campaignOptions }} />,
            },
          }
        })}
        empty={{ title: "No interns yet", description: "Invite interns and assign them to campaigns." }}
      />
    </>
  )
}
