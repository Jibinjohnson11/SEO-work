import { NextResponse, type NextRequest } from "next/server"
import { authorize } from "@/lib/auth"
import { EXPORT_TYPES, renderExport, type ExportDoc, type ExportFormat } from "@/lib/export"

// Downloads a stored report snapshot. RLS decides visibility: Super Admin sees all; client
// users see only published reports of their workspace and need the download permission.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let session
  try {
    session = await authorize(["super_admin", "client"])
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const format = (request.nextUrl.searchParams.get("format") ?? "pdf") as ExportFormat
  if (!(format in EXPORT_TYPES) || !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Bad request" }, { status: 400 })
  const { supabase, profile } = session
  const { data: report } = await supabase.from("reports").select("id, title, data, client_id, period_start").eq("id", id).maybeSingle()
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (profile.role === "client") {
    const { data: clients } = await supabase.rpc("client_portal_clients")
    const ws = ((clients ?? []) as { id: string; can_download_reports: boolean; settings: { allow_report_download: boolean } }[]).find(
      (c) => c.id === report.client_id,
    )
    if (!ws?.can_download_reports || !ws.settings.allow_report_download)
      return NextResponse.json({ error: "Downloads are not enabled for your account" }, { status: 403 })
  }
  const body = await renderExport(report.data as ExportDoc, format)
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": EXPORT_TYPES[format],
      "Content-Disposition": `attachment; filename="report-${report.period_start}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
