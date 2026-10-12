import { AuthCard } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { signOut } from "@/server/auth-actions"

export default function NoAccessPage() {
  return (
    <AuthCard
      title="No access yet"
      description="Your account exists but has not been activated, has been disabled, or has no role assigned. Ask your administrator to send you an invitation."
    >
      <form action={signOut}>
        <Button type="submit" variant="outline" className="w-full">Sign out</Button>
      </form>
    </AuthCard>
  )
}
