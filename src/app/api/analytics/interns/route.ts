import { NextResponse, type NextRequest } from "next/server"
import { authorize } from "@/lib/auth"
import { EXPORT_TYPES, renderExport, type ExportFormat } from "@/lib/export"
import { getLookups, getSetting, resolvePeriod } from "@/server/queries"
import { internMetrics } from "@/server/intern-metrics"

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
  const [lookups, reports] = await Promise.all([getLookups(session.supabase), getSetting("reports")])
  const period = resolvePeriod(sp, reports.timezone, "this_month")
  const metrics = await internMetrics(session.supabase, { from: period.from, to: period.to, timeZone: reports.timezone })
  const cols = [
    ["name", "Team member"], ["tasks_assigned", "Tasks assigned"], ["tasks_completed", "Tasks completed"], ["target", "Assigned target"], ["submitted", "Submitted"],
    ["opportunities", "Opportunities"], ["content_drafts", "Content drafts"], ["internally_approved", "Internally approved"], ["client_approved", "Client approved"],
    ["published", "Published"], ["verified_live", "Verified live"], ["rejected", "Rejected"], ["revision_rate", "Revision rate %"], ["target_completion", "Target completion %"],
  ] as const
  const body = await renderExport(
    {
      title: "Team performance",
      subtitle: `${period.from} – ${period.to} · ${reports.timezone}`,
      sheets: [{
        name: "Team",
        columns: cols.map(([key, header]) => ({ key, header, numeric: key !== "name" })),
        rows: lookups.interns.map((i) => ({ name: i.full_name || i.email, ...(metrics.get(i.id) ?? {}) }) as Record<string, string | number | null>),
      }],
    },
    format,
  )
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": EXPORT_TYPES[format], "Content-Disposition": `attachment; filename="team-performance-${period.from}.${format}"`, "Cache-Control": "private, no-store" },
  })
}
