import Link from "next/link"
import { CircleCheck, CircleX, UserPlus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { ToneBadge } from "@/components/shared/status-badge"
import { InviteUserButton } from "@/components/admin/invite-user"
import { UserMenu } from "@/components/admin/user-actions"
import { BacklinkTypesManager } from "@/components/settings/backlink-types"
import { ApprovalSettings, CampaignDefaults, GeneralSettings, NotificationSettings, ReportSettings, SecuritySettings, VerificationSettings } from "@/components/settings/settings-forms"
import { formatDateTime } from "@/lib/format"
import { isEmailConfigured } from "@/lib/email"
import { serverEnv } from "@/lib/server-env"
import { cn } from "@/lib/utils"
import { getAllSettings, getLookups, param, type SearchParams } from "@/server/queries"
import type { BacklinkType, Profile } from "@/lib/types"

export const metadata = { title: "Settings" }

const TABS = [
  ["general", "General"],
  ["users", "Users & access"],
  ["campaigns", "Campaigns"],
  ["backlinks", "Backlink types"],
  ["verification", "Verification"],
  ["approval", "Approvals"],
  ["reports", "Reports"],
  ["notifications", "Notifications"],
  ["security", "Security"],
] as const

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase, profile } = await requireRole(["super_admin"])
  const tab = (TABS.find(([k]) => k === param(sp, "tab"))?.[0] ?? "general") as (typeof TABS)[number][0]
  const settings = await getAllSettings()
  const emailConfigured = isEmailConfigured()

  let body: React.ReactNode = null
  if (tab === "general") body = <GeneralSettings initial={settings.general} />
  if (tab === "campaigns") body = <CampaignDefaults initial={settings.campaign_defaults} />
  if (tab === "approval") body = <ApprovalSettings initial={settings.approval} />
  if (tab === "verification") body = <VerificationSettings initial={settings.verification} />
  if (tab === "reports") body = <ReportSettings initial={settings.reports} emailConfigured={emailConfigured} />
  if (tab === "notifications") body = <NotificationSettings initial={settings.notifications} emailConfigured={emailConfigured} />
  if (tab === "backlinks") {
    const [types, links, lookups] = await Promise.all([
      supabase.from("backlink_types").select("*").order("sort_order").order("name"),
      supabase.from("campaign_backlink_types").select("campaign_id, backlink_type_id"),
      getLookups(supabase),
    ])
    body = (
      <BacklinkTypesManager
        types={((types.data ?? []) as BacklinkType[]).map((t) => ({ ...t, campaign_ids: (links.data ?? []).filter((l) => l.backlink_type_id === t.id).map((l) => l.campaign_id) }))}
        campaigns={lookups.campaigns.filter((c) => c.status !== "archived").map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
      />
    )
  }
  if (tab === "users") {
    const [{ data: users }, lookups, members] = await Promise.all([
      supabase.from("profiles").select("*").order("role").order("full_name"),
      getLookups(supabase),
      supabase.from("client_members").select("user_id, client_id"),
    ])
    const clientOf = (id: string) => (members.data ?? []).filter((m) => m.user_id === id).map((m) => lookups.clients.find((c) => c.id === m.client_id)?.company_name).filter(Boolean).join(", ")
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-2xl text-sm text-muted-foreground">Roles are fixed: Super Admin (full control), Intern (assigned campaigns only) and Client (own workspace only). Fine-grained permissions are set per client workspace (approve / download) and per client portal. Super Admin access can only be granted from the database — see README. Approve self-registered accounts and choose which features each user can use in <Link href="/admin/users" className="text-primary hover:underline">Users &amp; Access</Link>.</p>
          <InviteUserButton clients={lookups.clients.map((c) => ({ value: c.id, label: c.company_name }))} campaigns={lookups.campaigns.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} defaults={settings.campaign_defaults}><UserPlus /> Invite user</InviteUserButton>
        </div>
        <DataTable
          searchPlaceholder="Search users…"
          columns={[{ key: "name", header: "User", sortable: true }, { key: "role", header: "Role", sortable: true }, { key: "scope", header: "Workspace" }, { key: "last", header: "Last sign-in", sortable: true }, { key: "status", header: "Status", sortable: true }, { key: "actions", header: "", className: "w-10" }]}
          rows={((users ?? []) as Profile[]).map((u) => ({
            id: u.id,
            search: `${u.full_name} ${u.email} ${u.role}`,
            sort: { name: u.full_name || u.email, role: u.role, last: u.last_sign_in_at, status: u.status },
            cells: {
              name: <span><span className="font-medium">{u.full_name || u.email}</span>{u.id === profile.id ? " (you)" : ""}<span className="block text-xs text-muted-foreground">{u.email}</span></span>,
              role: u.role ? <ToneBadge tone={u.role === "super_admin" ? "info" : "neutral"}>{u.role.replace("_", " ")}</ToneBadge> : <span className="text-muted-foreground">—</span>,
              scope: u.role === "client" ? clientOf(u.id) || "—" : u.role === "intern" ? <Link href={`/admin/interns/${u.id}`} className="text-primary hover:underline">Assignments</Link> : "Everything",
              last: formatDateTime(u.last_sign_in_at, settings.reports.timezone),
              status: <ToneBadge tone={u.status === "active" ? "success" : u.status === "invited" ? "info" : u.status === "pending" ? "warning" : "muted"}>{u.status}</ToneBadge>,
              actions: u.role === "super_admin" ? null : u.role === null ? <Link href="/admin/users?status=pending" className="text-xs text-primary hover:underline">Review</Link> : <UserMenu user={u} />,
            },
          }))}
        />
      </div>
    )
  }
  if (tab === "security") {
    const { data: signins } = await supabase.from("activity_logs").select("id, actor_id, summary, created_at").eq("action", "auth.sign_in").order("created_at", { ascending: false }).limit(25)
    const checks: [string, boolean, string][] = [
      ["Supabase service role key", Boolean(serverEnv.serviceRoleKey), "Needed for inviting users, disabling sessions and scheduled jobs"],
      ["Cron secret", Boolean(serverEnv.cronSecret), "Protects /api/cron/daily (verification, reminders, scheduled reports)"],
      ["Email provider", emailConfigured, "Optional: RESEND_API_KEY and EMAIL_FROM for email digests and report delivery"],
    ]
    body = (
      <div className="space-y-6">
        <SecuritySettings initial={settings.security} />
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Server configuration</h3>
          <ul className="divide-y rounded-lg border">
            {checks.map(([label, ok, hint]) => (
              <li key={label} className="flex items-center gap-3 px-3 py-2 text-sm">
                {ok ? <CircleCheck className="size-4 text-success" /> : <CircleX className="size-4 text-destructive" />}
                <span className="font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{ok ? "Configured" : "Not configured"} — {hint}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Recent sign-ins</h3><Link href="/admin/activity?action=auth" className="text-xs text-primary hover:underline">All access logs</Link></div>
          <ul className="divide-y rounded-lg border text-sm">
            {(signins ?? []).map((s) => <li key={s.id} className="flex justify-between px-3 py-2"><span>{s.summary}</span><span className="text-xs text-muted-foreground">{formatDateTime(s.created_at, settings.reports.timezone)}</span></li>)}
            {(signins ?? []).length === 0 ? <li className="px-3 py-2 text-muted-foreground">No sign-ins recorded yet.</li> : null}
          </ul>
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader title="Settings" description="Every operational setting is stored in the database and audited." />
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto lg:w-48 lg:flex-col">
          {TABS.map(([k, label]) => (
            <Link key={k} href={`/admin/settings?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground", tab === k && "bg-accent font-medium text-accent-foreground")}>
              {label}
            </Link>
          ))}
        </nav>
        <Section className="min-w-0 flex-1" title={TABS.find(([k]) => k === tab)![1]}>{body}</Section>
      </div>
    </>
  )
}
