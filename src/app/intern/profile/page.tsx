import Link from "next/link"
import { requireRole } from "@/lib/auth"
import { PageHeader, Section } from "@/components/shared/page-header"
import { ProfileForm } from "@/components/shared/profile-form"

export const metadata = { title: "Profile" }

export default async function ProfilePage() {
  const { profile } = await requireRole(["intern"])
  return (
    <>
      <PageHeader title="Profile & security" />
      <Section>
        <ProfileForm email={profile.email} initial={{ full_name: profile.full_name, phone: profile.phone ?? "", timezone: profile.timezone, email_notifications: profile.email_notifications }} />
      </Section>
      <p className="text-sm text-muted-foreground">To change your password, use <Link href="/forgot-password" className="text-primary hover:underline">reset password</Link>.</p>
    </>
  )
}
