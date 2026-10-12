import Link from "next/link"
import { notFound } from "next/navigation"
import { Archive, Pencil, RotateCcw, UserPlus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { DetailList, PageHeader, Section } from "@/components/shared/page-header"
import { StatCard, ProgressBar } from "@/components/shared/stat-card"
import { CampaignStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { ConfirmAction } from "@/components/shared/confirm-action"
import { EmptyState } from "@/components/shared/empty-state"
import { ClientFormButton } from "@/components/admin/client-form"
import { InviteUserButton } from "@/components/admin/invite-user"
import { MemberControls, PortalSettingsForm } from "@/components/admin/client-workspace"
import { buildReport, monthStart, todayIn } from "@/lib/reporting"
import { formatDay, formatDateTime } from "@/lib/format"
import { deleteClient, setClientStatus } from "@/server/admin/clients"
import { getSetting } from "@/server/queries"
import { loadReportData } from "@/server/report-data"
import type { Campaign, Client, PortalSettings } from "@/lib/types"

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireRole(["super_admin"])
  const { data: client } = await supabase.from("clients").select("*").eq("id", id).maybeSingle()
  if (!client) notFound()
  const c = client as Client
  const [campaigns, members, settingsRes, general, approval, reportsRes] = await Promise.all([
    supabase.from("campaigns").select("*").eq("client_id", id).order("code"),
    supabase.from("client_members").select("id, can_approve, can_download_reports, profiles(id, full_name, email, status, last_sign_in_at)").eq("client_id", id),
    supabase.rpc("client_portal_settings", { p_client_id: id }),
    getSetting("general"),
    getSetting("approval"),
    supabase.from("reports").select("id, title, status, period_start, period_end").eq("client_id", id).order("created_at", { ascending: false }).limit(10),
  ])
  const today = todayIn(c.timezone)
  const month = await loadReportData(supabase, { from: monthStart(today), to: today, timeZone: c.timezone, filters: { client: id } })
  const monthReport = buildReport({ ...month, from: monthStart(today), to: today, timeZone: c.timezone, groupBy: ["campaign"] })
  const byCampaign = new Map(monthReport.rows.map((r) => [r.dims.campaign!.id, r]))
  const camps = (campaigns.data ?? []) as Campaign[]
  const t = monthReport.totals
  const memberRows = (members.data ?? []) as unknown as { id: string; can_approve: boolean; can_download_reports: boolean; profiles: { id: string; full_name: string; email: string; status: string; last_sign_in_at: string | null } }[]

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {c.company_name}
            {c.status !== "active" ? <ToneBadge tone={c.status === "paused" ? "warning" : "muted"}>{c.status}</ToneBadge> : null}
            {c.is_medical ? <ToneBadge tone="warning">Medical</ToneBadge> : null}
          </span>
        }
        description={`${c.code}${c.industry ? ` · ${c.industry}` : ""} · ${c.timezone}`}
        actions={
          <>
            <ClientFormButton client={c} variant="outline" defaults={{ timezone: general.default_timezone, internal_review_required: approval.internal_review_required, client_approval_required: approval.client_approval_required, reapproval_on_material_change: approval.reapproval_on_material_change }}>
              <Pencil /> Edit
            </ClientFormButton>
            {c.status === "archived" ? (
              <ConfirmAction title="Restore client?" onConfirm={setClientStatus.bind(null, c.id, "active")}>
                <RotateCcw /> Restore
              </ConfirmAction>
            ) : (
              <ConfirmAction title={`Archive ${c.company_name}?`} description="Archived clients are hidden from lists but all campaigns, submissions and history are kept." confirmLabel="Archive" onConfirm={setClientStatus.bind(null, c.id, "archived")}>
                <Archive /> Archive
              </ConfirmAction>
            )}
            {camps.length === 0 ? (
              <ConfirmAction title="Delete client permanently?" description="Only possible for clients with no campaigns. The audit log keeps a record." destructive confirmLabel="Delete" onConfirm={deleteClient.bind(null, c.id)} variant="ghost">
                Delete
              </ConfirmAction>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Active campaigns" value={camps.filter((x) => x.status === "active").length} />
        <StatCard label="Submitted this month" value={t.submitted} />
        <StatCard label="Client approved this month" value={t.client_approved} />
        <StatCard label="Published this month" value={t.published} />
        <StatCard label="Verified live this month" value={t.verified_live} tone="success" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Client details" className="lg:col-span-2">
          <DetailList
            items={[
              { label: "Website", value: c.website_url ? <a href={c.website_url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{c.website_url}</a> : "—" },
              { label: "Contact", value: c.contact_person ? `${c.contact_person}${c.contact_email ? ` · ${c.contact_email}` : ""}${c.contact_phone ? ` · ${c.contact_phone}` : ""}` : "—" },
              { label: "Country", value: c.country ?? "—" },
              { label: "Start date", value: formatDay(c.start_date, general.date_format) },
              { label: "Approval workflow", value: [c.require_internal_review && "Internal review", c.require_client_approval && "Client approval", c.reapproval_on_material_change && "Re-approval on material edits"].filter(Boolean).join(" → ") || "No approvals required" },
              { label: "Internal notes", value: c.notes ?? "—" },
            ]}
          />
        </Section>
        <Section title="Reports shared" description="Snapshots published to this workspace" actions={<Link href={`/admin/reports/daily?client=${c.id}`} className="text-xs text-primary hover:underline">Open reports</Link>}>
          {(reportsRes.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No report snapshots yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(reportsRes.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.title}</span>
                  <ToneBadge tone={r.status === "published" ? "success" : "muted"}>{r.status}</ToneBadge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Campaigns" description="Progress is verified live backlinks this month vs. monthly target" bodyClassName="p-0" actions={<Link href={`/admin/campaigns?client=${c.id}`} className="text-xs text-primary hover:underline">Manage campaigns</Link>}>
        {camps.length === 0 ? (
          <EmptyState title="No campaigns" description="Create a campaign for this client from the Campaigns page." />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {camps.map((cp) => {
                const r = byCampaign.get(cp.id)
                return (
                  <tr key={cp.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/campaigns/${cp.id}`} className="font-medium hover:text-primary">{cp.code}</Link>
                      <span className="block text-xs text-muted-foreground">{cp.name}</span>
                    </td>
                    <td className="px-4 py-2.5"><CampaignStatusBadge status={cp.status} /></td>
                    <td className="tabular px-4 py-2.5 text-right text-xs text-muted-foreground">{r?.submitted ?? 0} submitted · {r?.verified_live ?? 0} verified</td>
                    <td className="w-48 px-4 py-2.5"><ProgressBar value={r?.verified_live ?? 0} max={cp.monthly_target} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="Portal users"
        description="People at the client who review content and read reports"
        actions={<InviteUserButton role="client" fixedClientId={c.id} variant="outline"><UserPlus /> Invite client user</InviteUserButton>}
        bodyClassName="p-0"
      >
        {memberRows.length === 0 ? (
          <EmptyState title="No portal users" description="Invite someone from the client to review and approve content." />
        ) : (
          <ul>
            {memberRows.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 last:border-0">
                <div>
                  <div className="text-sm font-medium">{m.profiles.full_name || m.profiles.email} <ToneBadge tone={m.profiles.status === "active" ? "success" : m.profiles.status === "invited" ? "info" : "muted"}>{m.profiles.status}</ToneBadge></div>
                  <div className="text-xs text-muted-foreground">{m.profiles.email} · last sign-in {formatDateTime(m.profiles.last_sign_in_at, c.timezone)}</div>
                </div>
                <MemberControls memberId={m.id} canApprove={m.can_approve} canDownload={m.can_download_reports} name={m.profiles.full_name || m.profiles.email} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Portal visibility" description="Choose what this client can see in their portal. Internal notes, reviews and team assignments are never shown.">
        <PortalSettingsForm clientId={c.id} settings={settingsRes.data as PortalSettings} />
      </Section>
    </>
  )
}
