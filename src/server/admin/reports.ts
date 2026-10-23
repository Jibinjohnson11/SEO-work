"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ActionError, authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { getSetting } from "@/server/queries"
import { unifiedReport, unifiedToExport } from "@/server/unified-report"

const id = z.string().uuid()
/**
 * Freezes the current Reports view into a snapshot (stored once; switching periods never writes
 * anything). Yearly and custom periods use the "custom" kind; filters.period keeps the exact type.
 */
export async function saveReportSnapshot(query: string, title: string) {
  return run(async () => {
    const { supabase, userId } = await authorize(["super_admin"])
    const sp = Object.fromEntries(new URLSearchParams(z.string().max(2000).parse(query)))
    const { timezone } = await getSetting("reports")
    const ctx = await unifiedReport(supabase, sp, timezone)
    const doc = unifiedToExport(ctx, z.string().trim().min(1).max(200).parse(title))
    const kind = ctx.range.period === "yearly" ? "custom" : ctx.range.period
    const row = must(
      await supabase
        .from("reports")
        .insert({
          kind,
          client_id: ctx.filters.client || null,
          title: doc.title,
          period_start: ctx.range.from,
          period_end: ctx.range.to,
          timezone: ctx.timeZone,
          filters: { ...sp, period: ctx.range.period },
          data: doc,
          generated_by: userId,
        })
        .select("id")
        .single(),
    )
    revalidatePath("/admin/reports", "layout")
    return row.id as string
  }, "Report snapshot saved")
}

export async function setReportPublished(reportId: string, published: boolean) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.rpc("report_set_published", { p_report_id: id.parse(reportId), p_published: published }))
    revalidatePath("/admin/reports", "layout")
  }, published ? "Report published to client" : "Report unpublished")
}

export async function deleteReport(reportId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const deleted = must(await supabase.from("reports").delete().eq("id", id.parse(reportId)).eq("status", "draft").select("id"))
    if (!deleted.length) throw new ActionError("Only draft reports can be deleted. Unpublish this report first.")
    revalidatePath("/admin/reports", "layout")
  }, "Draft report deleted")
}
