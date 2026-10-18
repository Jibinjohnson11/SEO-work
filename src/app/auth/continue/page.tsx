import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { safeRedirectPath } from "@/lib/url"

export const metadata = { title: "Continue" }

const COPY: Record<string, { title: string; description: string; button: string }> = {
  invite: { title: "Accept your invitation", description: "Continue to set your password and open your workspace.", button: "Accept invitation" },
  recovery: { title: "Reset your password", description: "Continue to choose a new password.", button: "Continue" },
  signup: { title: "Confirm your email", description: "Continue to confirm your email address.", button: "Confirm email" },
  email: { title: "Confirm your email", description: "Continue to confirm your email address.", button: "Confirm email" },
}
const FALLBACK = { title: "Continue", description: "Continue to finish signing in.", button: "Continue" }

// Second step of an emailed link (see src/app/auth/confirm/route.ts). The one-time token is only
// used when the person presses the button, so link scanners that open the URL cannot spend it.
export default async function ContinuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const tokenHash = typeof sp.token_hash === "string" ? sp.token_hash : ""
  const type = typeof sp.type === "string" ? sp.type : ""
  if (!tokenHash || !type) redirect("/login?error=link")
  const next = safeRedirectPath(typeof sp.next === "string" ? sp.next : "", "/")
  const copy = COPY[type] ?? FALLBACK

  return (
    <AuthCard title={copy.title} description={copy.description}>
      <form method="post" action="/auth/confirm">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <Button type="submit" className="w-full" size="lg">
          {copy.button}
        </Button>
      </form>
    </AuthCard>
  )
}
