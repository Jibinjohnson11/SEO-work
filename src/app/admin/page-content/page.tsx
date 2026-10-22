import { requireRole } from "@/lib/auth"
import type { SearchParams } from "@/server/queries"
import { ContentWorkspace } from "@/server/content-list"

export const metadata = { title: "Off-Page Content" }

// Content prepared for backlinks before publication; the client approves it (the only approval stage).
// Separate from Backlink Submissions: nothing here creates, reviews or publishes a backlink.
export default async function OffPageContentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  return (
    <ContentWorkspace
      supabase={supabase}
      sp={sp}
      header={{ title: "Off-Page Content", description: "Content for campaign backlinks, approved by the client before publication" }}
    />
  )
}
