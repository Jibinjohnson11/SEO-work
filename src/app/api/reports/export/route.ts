import { NextResponse, type NextRequest } from "next/server"
import { authorize } from "@/lib/auth"
import { EXPORT_TYPES, renderExport, type ExportFormat } from "@/lib/export"
import { getSetting } from "@/server/queries"
import { reportContext, reportToExport } from "@/server/report-data"

// Live report export for the Super Admin (Excel / CSV / PDF) using the same filters as the page.
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
  const kind = ["daily", "weekly", "monthly"].includes(sp.kind) ? sp.kind : "daily"
  const reports = await getSetting("reports")
  const ctx = await reportContext(session.supabase, sp, {
    period: kind === "weekly" ? "this_week" : kind === "monthly" ? "this_month" : "today",
    reportTz: reports.timezone,
  })
  const title = `${kind[0].toUpperCase()}${kind.slice(1)} backlink report`
  const body = await renderExport(reportToExport(ctx, title), format)
  const filename = `linkops-${kind}-${ctx.period.from}${ctx.period.to !== ctx.period.from ? `_${ctx.period.to}` : ""}.${format}`
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": EXPORT_TYPES[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
