import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth-card"
import { isSupabaseConfigured, missingPublicConfig } from "@/lib/env"

export const metadata = { title: "Configuration required" }

// Shown when the app is deployed without its Supabase configuration. Nothing is simulated.
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/login")
  return (
    <AuthCard title="Configuration required" description="LinkOps cannot start until it is connected to Supabase.">
      <div className="space-y-3 text-sm">
        <p>Set these environment variables, then restart or redeploy:</p>
        <ul className="space-y-1 rounded-md bg-muted p-3 font-mono text-xs">
          {missingPublicConfig().map((v) => (
            <li key={v}>{v}</li>
          ))}
          <li className="text-muted-foreground">SUPABASE_SERVICE_ROLE_KEY (server only — invitations, scheduled jobs)</li>
          <li className="text-muted-foreground">CRON_SECRET (scheduled jobs)</li>
        </ul>
        <p className="text-muted-foreground">See README.md → “Setup” for the database migrations and Super Admin bootstrap.</p>
      </div>
    </AuthCard>
  )
}
