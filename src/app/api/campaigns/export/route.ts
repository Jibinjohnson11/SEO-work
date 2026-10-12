import { NextResponse } from "next/server"
import { authorize } from "@/lib/auth"
import { renderExport } from "@/lib/export"

// Same columns as the campaign import, so an export can be edited and re-imported (campaign_code updates).
export async function GET() {
  let session
  try {
    session = await authorize(["super_admin"])
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { supabase } = session
  const [{ data: campaigns }, { data: links }] = await Promise.all([
    supabase.from("campaigns").select("*, clients(code)").order("code"),
    supabase.from("campaign_keywords").select("campaign_id, is_primary, keywords(keyword)"),
  ])
  const kw = (links ?? []) as unknown as { campaign_id: string; is_primary: boolean; keywords: { keyword: string } }[]
  const cols = ["client", "campaign_code", "campaign_name", "primary_keyword", "secondary_keywords", "target_url", "priority", "start_date", "end_date", "monthly_target", "daily_target", "weekly_target", "status", "description"]
  const body = await renderExport(
    {
      title: "Campaigns",
      sheets: [{
        name: "Campaigns",
        columns: cols.map((c) => ({ key: c, header: c })),
        rows: (campaigns ?? []).map((c) => ({
          client: c.clients.code,
          campaign_code: c.code,
          campaign_name: c.name,
          primary_keyword: kw.find((k) => k.campaign_id === c.id && k.is_primary)?.keywords.keyword ?? "",
          secondary_keywords: kw.filter((k) => k.campaign_id === c.id && !k.is_primary).map((k) => k.keywords.keyword).join("; "),
          target_url: c.target_url, priority: c.priority, start_date: c.start_date, end_date: c.end_date,
          monthly_target: c.monthly_target, daily_target: c.daily_target, weekly_target: c.weekly_target, status: c.status, description: c.description,
        })),
      }],
    },
    "csv",
  )
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="campaigns.csv"`, "Cache-Control": "private, no-store" },
  })
}
