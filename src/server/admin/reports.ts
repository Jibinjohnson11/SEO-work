"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { getSetting } from "@/server/queries"
import { reportContext, reportToExport } from "@/server/report-data"

const id = z.string().uuid()
const kindSchema = z.enum(["daily", "weekly", "monthly", "custom"])

/** Freezes the current report view into a snapshot that can be published to a client. */
export async function saveReportSnapshot(kind: "daily" | "weekly" | "monthly" | "custom", query: string, title: string) {
  return run(async () => {
    const { supabase, userId } = await authorize(["super_admin"])
    const sp = Object.fromEntries(new URLSearchParams(z.string().max(2000).parse(query)))
    const reports = await getSetting("reports")
    const defaultPeriod = kind === "weekly" ? "this_week" : kind === "monthly" ? "this_month" : "today"
    const ctx = await reportContext(supabase, sp, { period: defaultPeriod, reportTz: reports.timezone })
    const doc = reportToExport(ctx, z.string().trim().min(1).max(200).parse(title))
    const row = must(
      await supabase
        .from("reports")
        .insert({
          kind: kindSchema.parse(kind),
          client_id: ctx.filters.client || null,
          title: doc.title,
          period_start: ctx.period.from,
          period_end: ctx.period.to,
          timezone: ctx.timeZone,
          filters: sp,
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
    must(await supabase.from("reports").delete().eq("id", id.parse(reportId)).eq("status", "draft"))
    revalidatePath("/admin/reports", "layout")
  }, "Draft report deleted")
}
