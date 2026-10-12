"use client"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/empty-state"
import { TriangleAlert } from "lucide-react"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title="This page could not be loaded"
      description={error.digest ? `Reference: ${error.digest}` : error.message}
      action={<Button onClick={reset}>Try again</Button>}
    />
  )
}
