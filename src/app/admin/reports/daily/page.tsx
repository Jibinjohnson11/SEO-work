import { ReportView } from "@/components/reports/report-view"
import type { SearchParams } from "@/server/queries"

export const metadata = { title: "Daily Reports" }

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <ReportView kind="daily" searchParams={await searchParams} />
}
