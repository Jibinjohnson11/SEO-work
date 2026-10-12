import { LinkButton } from "@/components/ui/link-button"
import { EmptyState } from "@/components/shared/empty-state"

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <EmptyState title="Not found" description="The page or record does not exist, or you do not have access to it." action={<LinkButton href="/" variant="default">Go home</LinkButton>} />
    </div>
  )
}
