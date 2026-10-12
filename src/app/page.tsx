import { redirect } from "next/navigation"
import { getSession, HOME_FOR_ROLE } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/env"

export const dynamic = "force-dynamic"

export default async function Home() {
  if (!isSupabaseConfigured()) redirect("/setup")
  const session = await getSession()
  if (!session) redirect("/login")
  if (!session.profile || session.profile.status !== "active") redirect("/auth/no-access")
  redirect(HOME_FOR_ROLE[session.profile.role])
}
