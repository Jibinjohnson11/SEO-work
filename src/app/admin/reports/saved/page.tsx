import { redirect } from "next/navigation"

// Saved reports are listed on the Reports page (breadcrumb target).
export default function SavedReports() {
  redirect("/admin/reports#saved")
}
