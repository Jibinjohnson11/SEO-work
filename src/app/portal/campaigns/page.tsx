import { requireRole } from "@/lib/auth"
import { CardGrid, ViewDetailsLink } from "@/components/shared/card-grid"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { ProgressBar } from "@/components/shared/stat-card"
import { CampaignStatusBadge } from "@/components/shared/status-badge"
import { formatDay } from "@/lib/format"
import { portalCampaigns } from "@/server/portal"

export const metadata = { title: "Campaigns" }

export default async function PortalCampaigns() {
  const { supabase } = await requireRole(["client"], "portal.campaigns")
  const campaigns = await portalCampaigns(supabase)
  return (
    <>
      <PageHeader title="Campaigns" description="Your SEO campaigns and this month's progress." />
      {campaigns.length === 0 ? <EmptyState title="No campaigns to show yet" /> : (
        <CardGrid>
          {campaigns.map((c) => (
            <li key={c.id} className="min-w-0">
              <div className="surface surface-hover flex h-full flex-col overflow-hidden shadow-xs">
                <div className="flex items-start gap-2 border-b border-primary/15 bg-primary/10 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" title={c.name}>{c.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.code} · {formatDay(c.start_date)} → {formatDay(c.end_date)}</div>
                  </div>
                  <CampaignStatusBadge status={c.status} />
                </div>
                <div className="flex flex-1 flex-col gap-3 px-4 py-3">
                  <div className="text-sm"><span className="text-muted-foreground">Keywords:</span> {c.keywords.join(", ") || "—"}</div>
                  {c.target_url ? <div className="truncate text-sm" title={c.target_url}><span className="text-muted-foreground">Target page:</span> <a className="text-primary hover:underline" href={c.target_url} target="_blank" rel="noreferrer noopener">{c.target_url}</a></div> : null}
                  {c.month_submitted !== null ? (
                    <dl className="grid grid-cols-2 gap-2 rounded-lg border bg-background/40 p-2 text-center sm:grid-cols-4">
                      {([["Proposed", c.month_submitted], ["Approved", c.month_client_approved], ["Published", c.month_published], ["Verified", c.month_verified]] as const).map(([l, v]) => (
                        <div key={l} className="min-w-0"><dt className="truncate text-[11px] text-muted-foreground">{l}</dt><dd className="tabular text-base font-semibold">{v ?? 0}</dd></div>
                      ))}
                    </dl>
                  ) : null}
                  {c.monthly_target ? <div><div className="mb-1 text-xs text-muted-foreground">Verified this month vs. target of {c.monthly_target}</div><ProgressBar value={c.month_verified ?? 0} max={c.monthly_target} /></div> : null}
                </div>
                {c.awaiting_approval ? (
                  <div className="flex min-h-11 items-center border-t px-3 py-1.5">
                    <ViewDetailsLink href="/portal/approvals" className="ml-auto" />
                    <span className="order-first text-xs font-medium text-primary">{c.awaiting_approval} awaiting your approval</span>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </CardGrid>
      )}
    </>
  )
}
