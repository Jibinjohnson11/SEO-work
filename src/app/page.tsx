import { redirect } from "next/navigation"
import { getSession, landingFor } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/env"

export const dynamic = "force-dynamic"

export default async function Home() {
  if (!isSupabaseConfigured()) redirect("/setup")
  const session = await getSession()
  if (!session) redirect("/login")
  redirect(landingFor(session.profile, session.permissions))
}
