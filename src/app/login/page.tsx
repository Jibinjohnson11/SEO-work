import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth-card"
import { getSession, HOME_FOR_ROLE } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/env"
import { LoginForm } from "./login-form"

export const metadata = { title: "Sign in" }

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  if (!isSupabaseConfigured()) redirect("/setup")
  const session = await getSession()
  if (session?.profile?.status === "active") redirect(HOME_FOR_ROLE[session.profile.role])
  const next = typeof sp.next === "string" ? sp.next : undefined
  const notice = sp.error === "link" ? "That link is invalid or has expired. Request a new one." : undefined
  return (
    <AuthCard title="Sign in" description="Access is by invitation only." footer="Accounts are created by your administrator.">
      <LoginForm next={next} notice={notice} />
    </AuthCard>
  )
}
