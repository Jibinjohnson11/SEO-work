import Link from "next/link"
import { notFound } from "next/navigation"
import { Archive, Pencil, RotateCcw, UserPlus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { DetailList, PageHeader, Section } from "@/components/shared/page-header"
import { StatCard, ProgressBar } from "@/components/shared/stat-card"
import { CampaignStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { ConfirmAction } from "@/components/shared/confirm-action"
import { BrandLogo } from "@/components/shared/brand-logo"
import { EmptyState } from "@/components/shared/empty-state"
import { ClientFormButton } from "@/components/admin/client-form"
import { InviteUserButton } from "@/components/admin/invite-user"
import { MemberControls, PortalSettingsForm } from "@/components/admin/client-workspace"
import { buildReport, monthStart, todayIn } from "@/lib/reporting"
import { formatDay, formatDateTime } from "@/lib/format"
import { deleteClient, setClientStatus } from "@/server/admin/clients"
import { getSetting } from "@/server/queries"
import { brandLogoUrls } from "@/server/brand-logos"
import { loadReportData } from "@/server/report-data"
import type { Tone } from "@/lib/workflow"
import type { Campaign, Client, ClientStatus, PortalSettings } from "@/lib/types"

const STATUS_TONE = { active: "success", paused: "warning", archived: "muted" } as const satisfies Record<ClientStatus, Tone>
const STATUS_LABEL: Record<ClientStatus, string> = { active: "Active", paused: "Paused", archived: "Archived" }

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireRole(["super_admin"])
  const { data: client } = await supabase.from("clients").select("*").eq("id", id).maybeSingle()
  if (!client) notFound()
  const c = client as Client
  const [campaigns, members, settingsRes, general, approval, reportsRes, logos, assignments, creator] = await Promise.all([
    supabase.from("campaigns").select("*").eq("client_id", id).order("code"),
    supabase.from("client_members").select("id, can_approve, can_download_reports, profiles(id, full_name, email, status, last_sign_in_at)").eq("client_id", id),
    supabase.rpc("client_portal_settings", { p_client_id: id }),
    getSetting("general"),
    getSetting("approval"),
    supabase.from("reports").select("id, title, status, period_start, period_end").eq("client_id", id).order("created_at", { ascending: false }).limit(10),
    brandLogoUrls(supabase, [c.logo_path]),
    supabase.from("intern_assignments").select("intern_id, profiles!intern_id(full_name, email), campaigns!inner(client_id)").eq("is_active", true).eq("campaigns.client_id", id),
    c.created_by ? supabase.from("profiles").select("full_name, email").eq("id", c.created_by).maybeSingle() : null,
  ])
  const logoUrl = c.logo_path ? (logos.get(c.logo_path) ?? null) : null
  const today = todayIn(c.timezone)
  const month = await loadReportData(supabase, { from: monthStart(today), to: today, timeZone: c.timezone, filters: { client: id } })
  const monthReport = buildReport({ ...month, from: monthStart(today), to: today, timeZone: c.timezone, groupBy: ["campaign"] })
  const byCampaign = new Map(monthReport.rows.map((r) => [r.dims.campaign!.id, r]))
  const camps = (campaigns.data ?? []) as Campaign[]
  const t = monthReport.totals
  // Team members actively assigned to any of this brand's campaigns.
  const team = new Map<string, string>()
  for (const a of (assignments.data ?? []) as unknown as { intern_id: string; profiles: { full_name: string | null; email: string } | null }[])
    team.set(a.intern_id, a.profiles?.full_name || a.profiles?.email || "Team member")
  const createdBy = creator?.data ? creator.data.full_name || creator.data.email : null
  const memberRows = (members.data ?? []) as unknown as { id: string; can_approve: boolean; can_download_reports: boolean; profiles: { id: string; full_name: string; email: string; status: string; last_sign_in_at: string | null } }[]

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <BrandLogo src={logoUrl} name={c.company_name} size="lg" />
            {c.company_name}
            <ToneBadge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</ToneBadge>
            {c.is_medical ? <ToneBadge tone="warning">Medical</ToneBadge> : null}
          </span>
        }
        description={`${c.code}${c.industry ? ` · ${c.industry}` : ""}${c.country ? ` · ${c.country}` : ""}`}
        actions={
          <>
            <ClientFormButton client={c} logoUrl={logoUrl} defaults={{ timezone: general.default_timezone, client_approval_required: approval.client_approval_required, reapproval_on_material_change: approval.reapproval_on_material_change }}>
              <Pencil /> Edit Brand
            </ClientFormButton>
            {c.status === "archived" ? (
              <ConfirmAction title="Restore brand?" onConfirm={setClientStatus.bind(null, c.id, "active")}>
                <RotateCcw /> Restore
              </ConfirmAction>
            ) : (
              <ConfirmAction title={`Archive ${c.company_name}?`} description="Archived brands are hidden from lists but all campaigns, submissions and history are kept." confirmLabel="Archive" onConfirm={setClientStatus.bind(null, c.id, "archived")}>
                <Archive /> Archive
              </ConfirmAction>
            )}
            {camps.length === 0 ? (
              <ConfirmAction title="Delete brand permanently?" description="Only possible for brands with no campaigns. The audit log keeps a record." destructive confirmLabel="Delete" onConfirm={deleteClient.bind(null, c.id)} variant="ghost">
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
        <Section title="General information" className="lg:col-span-2">
          <div className="flex flex-col gap-5 sm:flex-row">
            <BrandLogo src={logoUrl} name={c.company_name} size="lg" className="rounded-xl" />
            <DetailList
              className="flex-1"
              items={[
                { label: "Brand name", value: c.company_name },
                { label: "Brand code", value: c.code },
                { label: "Industry", value: c.industry ?? "—" },
                { label: "Location", value: c.country ?? "—" },
                { label: "Website", value: c.website_url ? <a href={c.website_url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline [overflow-wrap:anywhere]">{c.website_url}</a> : "—" },
                { label: "Contact person", value: c.contact_person ?? "—" },
                { label: "Contact email", value: c.contact_email ? <a href={`mailto:${c.contact_email}`} className="text-primary hover:underline [overflow-wrap:anywhere]">{c.contact_email}</a> : "—" },
                { label: "Contact number", value: c.contact_phone ?? "—" },
                { label: "Internal notes", value: c.notes ? <span className="whitespace-pre-line">{c.notes}</span> : "—" },
              ]}
            />
          </div>
        </Section>
        <Section title="Reports shared" description="Snapshots published to this workspace" actions={<Link href={`/admin/reports?client=${c.id}`} className="text-xs text-primary hover:underline">Open reports</Link>}>
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

      <Section title="Brand management">
        <DetailList
          items={[
            { label: "Status", value: <ToneBadge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</ToneBadge> },
            {
              label: "Assigned team",
              value: team.size ? (
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {[...team].sort((a, b) => a[1].localeCompare(b[1])).map(([internId, name]) => (
                    <Link key={internId} href={`/admin/interns/${internId}`} className="hover:text-primary">{name}</Link>
                  ))}
                </span>
              ) : "No one is assigned to this brand's campaigns",
            },
            { label: "Approval workflow", value: [c.is_medical && "Internal medical review", c.require_client_approval && "Client approval", c.reapproval_on_material_change && "Re-approval on material edits"].filter(Boolean).join(" → ") || "No approvals required" },
            { label: "Medical review", value: c.is_medical ? "Medical / healthcare brand — medical checklist required" : "Not required" },
          ]}
        />
      </Section>

      <Section title="Campaigns" description="Progress is verified live backlinks this month vs. monthly target" bodyClassName="p-0" actions={<Link href={`/admin/campaigns?client=${c.id}`} className="text-xs text-primary hover:underline">Manage campaigns</Link>}>
        {camps.length === 0 ? (
          <EmptyState title="No campaigns" description="Create a campaign for this brand from the Campaigns page." />
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
        description="People at the brand who review content and read reports"
        actions={<InviteUserButton role="client" fixedClientId={c.id} variant="outline"><UserPlus /> Invite client user</InviteUserButton>}
        bodyClassName="p-0"
      >
        {memberRows.length === 0 ? (
          <EmptyState title="No portal users" description="Invite someone from the brand to review and approve content." />
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

      <Section title="Portal visibility" description="Choose what this brand can see in their portal. Internal notes, reviews and team assignments are never shown.">
        <PortalSettingsForm clientId={c.id} settings={settingsRes.data as PortalSettings} />
      </Section>

      <Section title="Additional information">
        <DetailList
          items={[
            { label: "Time zone", value: c.timezone },
            { label: "Start date", value: formatDay(c.start_date, general.date_format) },
            { label: "Created", value: `${formatDateTime(c.created_at, c.timezone)}${createdBy ? ` by ${createdBy}` : ""}` },
            { label: "Last updated", value: formatDateTime(c.updated_at, c.timezone) },
            ...(c.archived_at ? [{ label: "Archived", value: formatDateTime(c.archived_at, c.timezone) }] : []),
          ]}
        />
      </Section>
    </>
  )
}
