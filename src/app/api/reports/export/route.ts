import { NextResponse, type NextRequest } from "next/server"
import { authorize } from "@/lib/auth"
import { EXPORT_TYPES, renderExport, type ExportFormat } from "@/lib/export"
import { getSetting } from "@/server/queries"
import { REPORT_PERIODS, unifiedReport, unifiedToExport } from "@/server/unified-report"

// Live export of the Reports page (Excel / CSV / PDF) with exactly the same period and filters.
export async function GET(request: NextRequest) {
  let session
  try {
    session = await authorize(["super_admin"])
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const sp = Object.fromEntries(request.nextUrl.searchParams)
  const format = (sp.format ?? "xlsx") as ExportFormat
  if (!(format in EXPORT_TYPES)) return NextResponse.json({ error: "Unsupported format" }, { status: 400 })
  const { timezone } = await getSetting("reports")
  const ctx = await unifiedReport(session.supabase, sp, timezone)
  const body = await renderExport(unifiedToExport(ctx, `${REPORT_PERIODS[ctx.range.period]} backlink report`), format)
  const filename = `linkops-${ctx.range.period}-${ctx.range.from}${ctx.range.to !== ctx.range.from ? `_${ctx.range.to}` : ""}.${format}`
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": EXPORT_TYPES[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
