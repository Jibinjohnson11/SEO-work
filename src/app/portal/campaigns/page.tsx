import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { ProgressBar } from "@/components/shared/stat-card"
import { CampaignStatusBadge } from "@/components/shared/status-badge"
import { formatDay } from "@/lib/format"
import { portalCampaigns } from "@/server/portal"

export const metadata = { title: "Campaigns" }

export default async function PortalCampaigns() {
  const { supabase } = await requireRole(["client"])
  const campaigns = await portalCampaigns(supabase)
  return (
    <>
      <PageHeader title="Campaigns" description="Your SEO campaigns and this month's progress." />
      {campaigns.length === 0 ? <EmptyState title="No campaigns to show yet" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {campaigns.map((c) => (
            <div key={c.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-semibold">{c.name}</div><div className="text-xs text-muted-foreground">{c.code} · {formatDay(c.start_date)} → {formatDay(c.end_date)}</div></div>
                <CampaignStatusBadge status={c.status} />
              </div>
              <div className="text-sm"><span className="text-muted-foreground">Keywords:</span> {c.keywords.join(", ") || "—"}</div>
              {c.target_url ? <div className="truncate text-sm"><span className="text-muted-foreground">Target page:</span> <a className="text-primary hover:underline" href={c.target_url} target="_blank" rel="noreferrer noopener">{c.target_url}</a></div> : null}
              {c.month_submitted !== null ? (
                <dl className="grid grid-cols-4 gap-2 border-t pt-3 text-center">
                  {([["Proposed", c.month_submitted], ["Approved", c.month_client_approved], ["Published", c.month_published], ["Verified", c.month_verified]] as const).map(([l, v]) => (
                    <div key={l}><dt className="text-[11px] text-muted-foreground">{l}</dt><dd className="tabular text-lg font-semibold">{v ?? 0}</dd></div>
                  ))}
                </dl>
              ) : null}
              {c.monthly_target ? <div><div className="mb-1 text-xs text-muted-foreground">Verified this month vs. target of {c.monthly_target}</div><ProgressBar value={c.month_verified ?? 0} max={c.monthly_target} /></div> : null}
              {c.awaiting_approval ? <p className="text-xs font-medium text-primary">{c.awaiting_approval} item(s) awaiting your approval</p> : null}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
