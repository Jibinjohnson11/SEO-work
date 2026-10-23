import { NextResponse } from "next/server"
import { authorize } from "@/lib/auth"
import { renderExport } from "@/lib/export"
import { fetchAll } from "@/server/queries"

// Same columns as the campaign import, so an export can be edited and re-imported (campaign_code updates).
export async function GET() {
  let session
  try {
    session = await authorize(["super_admin"])
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { supabase } = session
  type KeywordLink = { campaign_id: string; keyword_id: string; is_primary: boolean; keywords: { keyword: string } }
  // Paged past the API's 1,000-row cap; id breaks ties so no row is skipped or repeated.
  const [campaigns, links] = await Promise.all([
    fetchAll<Record<string, unknown> & { id: string; code: string; clients: { code: string } }>((a, b) =>
      supabase.from("campaigns").select("*, clients(code)").order("code").order("id").range(a, b)),
    fetchAll<KeywordLink>((a, b) =>
      supabase.from("campaign_keywords").select("campaign_id, keyword_id, is_primary, keywords(keyword)").order("campaign_id").order("keyword_id").range(a, b) as unknown as PromiseLike<{ data: KeywordLink[] | null; error: unknown }>),
  ])
  const byCampaign = new Map<string, KeywordLink[]>()
  for (const l of links) byCampaign.set(l.campaign_id, [...(byCampaign.get(l.campaign_id) ?? []), l])
  const cols = ["client", "campaign_code", "campaign_name", "primary_keyword", "secondary_keywords", "target_url", "priority", "start_date", "end_date", "monthly_target", "daily_target", "weekly_target", "status", "description"]
  const body = await renderExport(
    {
      title: "Campaigns",
      sheets: [{
        name: "Campaigns",
        columns: cols.map((c) => ({ key: c, header: c })),
        rows: campaigns.map((c) => {
          const kw = byCampaign.get(c.id) ?? []
          return {
            client: c.clients.code,
            campaign_code: c.code,
            campaign_name: c.name,
            primary_keyword: kw.find((k) => k.is_primary)?.keywords.keyword ?? "",
            secondary_keywords: kw.filter((k) => !k.is_primary).map((k) => k.keywords.keyword).join("; "),
            target_url: c.target_url, priority: c.priority, start_date: c.start_date, end_date: c.end_date,
            monthly_target: c.monthly_target, daily_target: c.daily_target, weekly_target: c.weekly_target, status: c.status, description: c.description,
          } as Record<string, string | number | null>
        }),
      }],
    },
    "csv",
  )
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="campaigns.csv"`, "Cache-Control": "private, no-store" },
  })
}
