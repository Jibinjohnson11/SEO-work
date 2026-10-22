import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import type { SearchParams } from "@/server/queries"
import { ContentWorkspace } from "@/server/content-list"

export const metadata = { title: "Off-Page Content" }

export default async function InternContent({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase, profile } = await requireRole(["intern"], "intern.content")
  return (
    <>
      <PageHeader title="Off-Page Content" description="Write content for your campaigns. The client approves it; if they ask for changes, edit and resubmit." />
      <ContentWorkspace supabase={supabase} sp={sp} mine={{ userId: profile.id }} />
    </>
  )
}
