import Link from "next/link"
import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth-card"
import { getSession, landingFor } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/env"
import { LoginForm } from "./login-form"

export const metadata = { title: "Sign in" }

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  if (!isSupabaseConfigured()) redirect("/setup")
  const session = await getSession()
  if (session?.profile && ["active", "pending", "rejected"].includes(session.profile.status)) redirect(landingFor(session.profile, session.permissions))
  const next = typeof sp.next === "string" ? sp.next : undefined
  const notice = sp.error === "link" ? "That link is invalid or has expired. Request a new one." : undefined
  return (
    <AuthCard
      title="Sign in"
      description="Sign in to your LinkOps workspace."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={next} notice={notice} />
    </AuthCard>
  )
}
