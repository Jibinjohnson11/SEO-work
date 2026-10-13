import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Clock, LockKeyhole, ShieldX } from "lucide-react"
import { AppShell } from "@/components/app-shell/app-shell"
import { LinkButton } from "@/components/ui/link-button"
import { Button } from "@/components/ui/button"
import { ACCESS_PAGE, getSession, landingFor } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/env"
import { formatDateTime } from "@/lib/format"
import { signOut } from "@/server/auth-actions"
import { getAllSettings } from "@/server/queries"

export const metadata = { title: "Account access" }
export const dynamic = "force-dynamic"

// Landing page for signed-in users without access to any feature: self-registered accounts
// awaiting review, rejected registrations, and approved users with no features enabled.
// It renders no data beyond the user's own profile.
export default async function AccessPage() {
  if (!isSupabaseConfigured()) redirect("/setup")
  const session = await getSession()
  if (!session) redirect("/login")
  const { profile, permissions } = session
  const landing = landingFor(profile, permissions)
  if (landing !== ACCESS_PAGE || !profile) redirect(landing)

  const [settings, cookieStore] = await Promise.all([getAllSettings(), cookies()])
  const state =
    profile.status === "pending"
      ? {
          icon: Clock,
          title: "Your account is awaiting administrator approval",
          body: "Thanks for registering. An administrator will review your account, assign your role and enable the features you need. You'll be able to use the dashboard as soon as that's done.",
        }
      : profile.status === "rejected"
        ? {
            icon: ShieldX,
            title: "Your registration was not approved",
            body: "An administrator reviewed this account and did not grant access. If you think this is a mistake, contact your administrator.",
          }
        : {
            icon: LockKeyhole,
            title: "No features have been enabled for your account yet",
            body: "Your account is approved, but an administrator has not given it access to any part of the dashboard. Contact your administrator if you need access.",
          }

  return (
    <AppShell
      user={{ name: profile.full_name, email: profile.email, role: profile.status === "active" ? profile.role : null, permissions: [] }}
      platformName={settings.general.platform_name}
      logoUrl={settings.general.logo_url || null}
      badges={{}}
      initialCollapsed={cookieStore.get("sidebar_collapsed")?.value === "1"}
      idleTimeoutMinutes={settings.security.idle_timeout_minutes}
    >
      <div className="mx-auto flex max-w-xl flex-col items-center gap-5 rounded-xl border bg-card px-6 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <state.icon className="size-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold tracking-tight" role="status">
            {state.title}
          </h1>
          <p className="text-sm text-muted-foreground">{state.body}</p>
        </div>
        <dl className="grid w-full grid-cols-1 gap-3 rounded-lg bg-muted/50 p-4 text-left text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Name</dt>
            <dd className="truncate font-medium">{profile.full_name || "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="truncate font-medium">{profile.email}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Registered</dt>
            <dd className="font-medium">{formatDateTime(profile.created_at, profile.timezone)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap justify-center gap-2">
          <LinkButton href="/" variant="default" size="default">
            Check again
          </LinkButton>
          <form action={signOut}>
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </AppShell>
  )
}
