import Link from "next/link"
import { redirect } from "next/navigation"
import { CircleCheck, CircleX } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { BacklinkTypesManager } from "@/components/settings/backlink-types"
import { ApprovalSettings, CampaignDefaults, GeneralSettings, NotificationSettings, ReportSettings, SecuritySettings, VerificationSettings } from "@/components/settings/settings-forms"
import { formatDateTime } from "@/lib/format"
import { isEmailConfigured } from "@/lib/email"
import { serverEnv } from "@/lib/server-env"
import { cn } from "@/lib/utils"
import { getAllSettings, getLookups, param, type SearchParams } from "@/server/queries"
import type { BacklinkType } from "@/lib/types"

export const metadata = { title: "Settings" }

const TABS = [
  ["general", "General"],
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
  const { supabase } = await requireRole(["super_admin"])
  // Users are managed on one page; old links to the former Settings tab land there.
  if (param(sp, "tab") === "users") redirect("/admin/users")
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
