"use client"

import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"
import { EmptyState } from "@/components/shared/empty-state"

// Error screen for pages outside the dashboards: sign-in, sign-up, password reset, /access, /auth/*.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description={error.digest ? `Please try again. Reference: ${error.digest}` : "Please try again."}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => retry()}>Try again</Button>
            <LinkButton href="/login" variant="outline">
              Back to sign in
            </LinkButton>
          </div>
        }
      />
    </div>
  )
}
