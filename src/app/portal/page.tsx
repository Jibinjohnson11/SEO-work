import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { ProgressBar, StatCard } from "@/components/shared/stat-card"
import { SubmissionStatusBadge } from "@/components/shared/status-badge"
import { EmptyState } from "@/components/shared/empty-state"
import { LinkButton } from "@/components/ui/link-button"
import { formatDateTime } from "@/lib/format"
import { portalCampaigns, portalClients, portalSubmissions } from "@/server/portal"

export const metadata = { title: "Overview" }

export default async function PortalHome() {
  const { supabase, profile } = await requireRole(["client"])
  const [clients, queue, campaigns] = await Promise.all([portalClients(supabase), portalSubmissions(supabase, true), portalCampaigns(supabase)])
  if (clients.length === 0) return <EmptyState title="No workspace yet" description="Your account is not linked to a client workspace. Contact your agency." />
  const sum = (k: "month_submitted" | "month_client_approved" | "month_published" | "month_verified") => campaigns.reduce((a, c) => a + (c[k] ?? 0), 0)
  const showProgress = clients.some((c) => c.settings.show_campaign_progress)
  const tz = clients[0].timezone
  return (
    <>
      <PageHeader title={clients.map((c) => c.company_name).join(", ")} description={`Welcome, ${profile.full_name || profile.email}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Awaiting your approval" value={queue.length} tone={queue.length ? "warning" : "default"} href="/portal/approvals" />
        <StatCard label="Active campaigns" value={campaigns.filter((c) => c.status === "active").length} href="/portal/campaigns" />
        {showProgress ? (
          <>
            <StatCard label="Approved this month" value={sum("month_client_approved")} />
            <StatCard label="Published this month" value={sum("month_published")} />
            <StatCard label="Verified live this month" value={sum("month_verified")} tone="success" />
          </>
        ) : null}
      </div>
      <Section title="Waiting for your review" bodyClassName="p-0" actions={queue.length ? <LinkButton href="/portal/approvals" variant="outline">Open queue</LinkButton> : null}>
        {queue.length === 0 ? <EmptyState title="You're all caught up" description="New content will appear here when it's ready for your approval." /> : (
          <ul>
            {queue.slice(0, 6).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 last:border-0">
                <Link href={`/portal/approvals/${s.id}`} className="min-w-0 hover:text-primary">
                  <span className="font-medium">{s.content_title ?? s.proposed_website}</span>
                  <span className="block text-xs text-muted-foreground">{s.campaign_code} · {s.backlink_type} · {s.proposed_website}</span>
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">sent {formatDateTime(s.sent_to_client_at, tz)} <SubmissionStatusBadge status={s.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {showProgress && campaigns.length ? (
        <Section title="Campaign progress this month" description="Verified live backlinks vs. monthly target" bodyClassName="p-0">
          <ul>
            {campaigns.filter((c) => c.status === "active").map((c) => (
              <li key={c.id} className="grid items-center gap-2 border-b px-4 py-3 text-sm last:border-0 sm:grid-cols-[1fr_200px]">
                <span><span className="font-medium">{c.name}</span><span className="block text-xs text-muted-foreground">{c.primary_keyword ?? c.code}</span></span>
                {c.monthly_target ? <ProgressBar value={c.month_verified ?? 0} max={c.monthly_target} /> : <span className="tabular text-xs text-muted-foreground">{c.month_verified ?? 0} verified</span>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  )
}
