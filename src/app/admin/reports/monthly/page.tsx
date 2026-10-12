import { ReportView } from "@/components/reports/report-view"
import type { SearchParams } from "@/server/queries"

export const metadata = { title: "Monthly Reports" }

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <ReportView kind="monthly" searchParams={await searchParams} />
}
