import { NextResponse, type NextRequest } from "next/server"
import { authorize } from "@/lib/auth"
import { renderExport } from "@/lib/export"
import { SUBMISSION_STATUS } from "@/lib/workflow"
import { getLookups, getSetting, labelMaps } from "@/server/queries"
import { querySubmissions } from "@/server/submission-list"

export async function GET(request: NextRequest) {
  let session
  try {
    session = await authorize(["super_admin"])
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const sp = Object.fromEntries(request.nextUrl.searchParams)
  const [lookups, reports] = await Promise.all([getLookups(session.supabase), getSetting("reports")])
  const subs = await querySubmissions(session.supabase, sp, { timeZone: reports.timezone, limit: 10000 })
  const l = labelMaps(lookups)
  const body = await renderExport(
    {
      title: "Backlink submissions",
      sheets: [
        {
          name: "Submissions",
          columns: [
            { key: "code", header: "Submission ID" }, { key: "client", header: "Client" }, { key: "campaign", header: "Campaign" }, { key: "keyword", header: "Keyword" },
            { key: "intern", header: "Intern" }, { key: "type", header: "Backlink Type" }, { key: "website", header: "Proposed Website" }, { key: "placement", header: "Placement URL" },
            { key: "target", header: "Target URL" }, { key: "anchor", header: "Anchor Text" }, { key: "title", header: "Content Title" }, { key: "status", header: "Status" },
            { key: "version", header: "Version", numeric: true }, { key: "submitted", header: "First Submitted (UTC)" }, { key: "updated", header: "Updated (UTC)" },
          ],
          rows: subs.map((s) => ({
            code: s.code, client: l.client[s.client_id], campaign: l.campaign[s.campaign_id], keyword: s.keyword_id ? l.keyword[s.keyword_id] : "", intern: l.intern[s.intern_id],
            type: l.backlink_type[s.backlink_type_id], website: s.proposed_website, placement: s.placement_url, target: s.target_url, anchor: s.anchor_text, title: s.content_title,
            status: SUBMISSION_STATUS[s.status].label, version: s.current_version, submitted: s.first_submitted_at, updated: s.updated_at,
          })),
        },
      ],
    },
    "csv",
  )
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="submissions.csv"`, "Cache-Control": "private, no-store" },
  })
}
