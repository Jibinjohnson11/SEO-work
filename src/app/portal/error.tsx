"use client"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/empty-state"
import { TriangleAlert } from "lucide-react"

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title="This page could not be loaded"
      description={error.digest ? `Reference: ${error.digest}` : error.message}
      action={<Button onClick={() => retry()}>Try again</Button>}
    />
  )
}
