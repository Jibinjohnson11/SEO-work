import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { ToneBadge } from "@/components/shared/status-badge"
import { ConfirmAction } from "@/components/shared/confirm-action"
import { ApproveUserButton, ManageAccessButton, RoleDefaultsForm, type RoleDefaults } from "@/components/admin/access-manager"
import { UserMenu } from "@/components/admin/user-actions"
import { InviteUserButton } from "@/components/admin/invite-user"
import { UserPlus } from "lucide-react"
import { formatDateTime } from "@/lib/format"
import { FEATURES, ROLE_LABELS, type AssignableRole } from "@/lib/permissions"
import { getLookups, getSetting, param, type SearchParams } from "@/server/queries"
import { rejectUser } from "@/server/admin/access"
import { accountsWithoutProfile, type AccountWithoutProfile } from "@/server/admin/auth-accounts"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Profile, UserStatus } from "@/lib/types"
import type { Tone } from "@/lib/workflow"

export const metadata = { title: "Users & Access" }

const STATUS_TONE: Record<UserStatus, Tone> = { active: "success", invited: "info", pending: "warning", rejected: "danger", disabled: "muted" }

export default async function UsersAccessPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase, profile: me } = await requireRole(["super_admin"])
  const status = param(sp, "status")
  let q = supabase.from("profiles").select("*").order("created_at", { ascending: false })
  if (status) q = q.eq("status", status)
  const [{ data }, { data: defaultsRows }, lookups, reports, { data: allIds }, campaignDefaults] = await Promise.all([
    q,
    supabase.from("role_permissions").select("role, features"),
    getLookups(supabase),
    getSetting("reports"),
    supabase.from("profiles").select("id"),
    getSetting("campaign_defaults"),
  ])
  // Sign-in accounts created outside LinkOps (e.g. invited from the Supabase dashboard) have no
  // profile, so no role and no access. They are listed so a Super Admin can link them by inviting.
  let unlinked: AccountWithoutProfile[] = []
  let unlinkedError = false
  try {
    unlinked = await accountsWithoutProfile(createAdminClient(), new Set((allIds ?? []).map((r) => r.id as string)))
  } catch (error) {
    console.error("[users] could not list sign-in accounts without a profile", error)
    unlinkedError = true
  }
  const users = (data ?? []) as Profile[]
  const roleDefaults: RoleDefaults = { intern: [], client: [] }
  for (const r of (defaultsRows ?? []) as { role: AssignableRole; features: string[] }[]) roleDefaults[r.role] = r.features
  const clients = lookups.clients.map((c) => ({ value: c.id, label: c.company_name }))
  const campaigns = lookups.campaigns.filter((c) => c.status !== "archived").map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))
  const pending = users.filter((u) => u.status === "pending")

  const accessSummary = (u: Profile) => {
    if (u.role === "super_admin") return <span className="text-sm">All features</span>
    if (!u.role) return <span className="text-sm text-muted-foreground">None</span>
    const total = FEATURES[u.role].length
    const list = u.permissions ?? roleDefaults[u.role]
    const n = list.filter((k) => FEATURES[u.role as AssignableRole].some((f) => f.key === k)).length
    return (
      <span className="text-sm">
        {n === 0 ? "No features" : `${n} of ${total} features`}
        <span className="block text-xs text-muted-foreground">{u.permissions === null ? "Role defaults" : "Custom"}</span>
      </span>
    )
  }

  return (
    <>
      <PageHeader
        title="Users & Access"
        description="Invite users, approve new registrations, assign roles and choose which dashboard features each user can use. Access is checked on the server for every page, action and API call."
        actions={<InviteUserButton clients={clients} campaigns={campaigns} defaults={campaignDefaults}><UserPlus /> Invite user</InviteUserButton>}
      />

      {pending.length > 0 && status !== "pending" ? (
        <Section title={`Awaiting approval (${pending.length})`} description="These people registered themselves. They can sign in but see no features until you approve them." bodyClassName="p-0">
          <ul className="divide-y">
            {pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{u.full_name || u.email}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {u.email} · registered {formatDateTime(u.created_at, reports.timezone)}
                  </div>
                </div>
                <ApproveUserButton user={u} clients={clients} campaigns={campaigns} roleDefaults={roleDefaults} />
                <RejectButton user={u} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {unlinked.length > 0 ? (
        <Section
          title={`Sign-in accounts without a LinkOps profile (${unlinked.length})`}
          description="Created outside LinkOps, for example invited from the Supabase dashboard. They have no role and cannot open any dashboard. To give one access, invite the same email with Invite user above, from Team (Add Team Member) or from a brand's page (Invite client user): the existing account is linked with the role you choose, never duplicated."
          bodyClassName="p-0"
        >
          <ul className="divide-y">
            {unlinked.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{a.email}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    created {formatDateTime(a.created_at, reports.timezone)}
                    {a.invited_at ? ` · invited ${formatDateTime(a.invited_at, reports.timezone)}` : ""}
                    {a.last_sign_in_at ? ` · last sign-in ${formatDateTime(a.last_sign_in_at, reports.timezone)}` : ""}
                  </div>
                </div>
                <ToneBadge tone={a.confirmed ? "warning" : "info"}>{a.confirmed ? "Confirmed, no profile" : "Invited, not confirmed"}</ToneBadge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {unlinkedError ? <p className="text-sm text-muted-foreground">Sign-in accounts without a profile could not be listed (check SUPABASE_SERVICE_ROLE_KEY).</p> : null}

      <FilterBar
        filters={[
          {
            type: "select",
            key: "status",
            label: "Status",
            options: [
              { value: "pending", label: "Awaiting approval" },
              { value: "active", label: "Active" },
              { value: "invited", label: "Invited" },
              { value: "rejected", label: "Rejected" },
              { value: "disabled", label: "Disabled" },
            ],
          },
        ]}
      />
      <DataTable cards={{ title: "name", badge: "status", actions: "actions" }}
        searchPlaceholder="Search users…"
        columns={[
          { key: "name", header: "User", sortable: true },
          { key: "role", header: "Role", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "access", header: "Feature access" },
          { key: "registered", header: "Created", sortable: true },
          { key: "last", header: "Last sign-in", sortable: true },
          { key: "actions", header: "", className: "w-48" },
        ]}
        rows={users.map((u) => ({
          id: u.id,
          search: `${u.full_name} ${u.email} ${u.role ?? ""} ${u.status}`,
          sort: { name: u.full_name || u.email, role: u.role ?? "", status: u.status, registered: u.created_at, last: u.last_sign_in_at },
          cells: {
            name: (
              <span>
                <span className="font-medium">{u.full_name || u.email}</span>
                {u.id === me.id ? " (you)" : ""}
                <span className="block text-xs text-muted-foreground">{u.email}</span>
              </span>
            ),
            role: u.role ? <ToneBadge tone={u.role === "super_admin" ? "info" : "neutral"}>{ROLE_LABELS[u.role]}</ToneBadge> : <span className="text-muted-foreground">Not assigned</span>,
            status: <ToneBadge tone={STATUS_TONE[u.status]}>{u.status === "pending" ? "awaiting approval" : u.status}</ToneBadge>,
            access: accessSummary(u),
            registered: formatDateTime(u.created_at, reports.timezone),
            last: formatDateTime(u.last_sign_in_at, reports.timezone),
            actions:
              u.role === "super_admin" ? null : (
                <div className="flex items-center justify-end gap-1.5">
                  {u.role === null ? (
                    <>
                      <ApproveUserButton user={u} clients={clients} campaigns={campaigns} roleDefaults={roleDefaults} variant={u.status === "rejected" ? "outline" : "default"} />
                      {u.status === "pending" ? <RejectButton user={u} /> : null}
                    </>
                  ) : (
                    <>
                      <ManageAccessButton user={u} role={u.role} permissions={u.permissions} roleDefaults={roleDefaults} />
                      <UserMenu user={u} />
                    </>
                  )}
                </div>
              ),
          },
        }))}
        empty={{ title: "No users", description: status ? "No users with this status." : "Invite users with Invite user above, or share the sign-up page." }}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {(["intern", "client"] as const).map((role) => (
          <Section
            key={role}
            title={`${ROLE_LABELS[role]} role defaults`}
            description={`Features for ${role === "intern" ? "team members" : "client users"} set to “Follow role defaults”. Users with custom access are not affected.`}
          >
            <RoleDefaultsForm role={role} initial={roleDefaults[role]} />
          </Section>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Workspace-level client permissions (approve content, download reports) are still managed per workspace under{" "}
        <Link href="/admin/clients" className="text-primary hover:underline">
          Brands
        </Link>
        ; a client user needs both the feature and the workspace permission.
      </p>
    </>
  )
}

function RejectButton({ user }: { user: Profile }) {
  return (
    <ConfirmAction
      title={`Reject ${user.full_name || user.email}?`}
      description="They will stay without access and see that their registration was not approved. You can still approve them later."
      confirmLabel="Reject"
      destructive
      onConfirm={rejectUser.bind(null, user.id)}
    >
      Reject
    </ConfirmAction>
  )
}
