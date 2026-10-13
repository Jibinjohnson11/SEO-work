import Link from "next/link"
import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth-card"
import { getSession, landingFor } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/env"
import { SignUpForm } from "./signup-form"

export const metadata = { title: "Create account" }

export default async function SignUpPage() {
  if (!isSupabaseConfigured()) redirect("/setup")
  const session = await getSession()
  if (session?.profile) redirect(landingFor(session.profile, session.permissions))
  return (
    <AuthCard
      title="Create account"
      description="New accounts are reviewed by an administrator before any features are enabled."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthCard>
  )
}
