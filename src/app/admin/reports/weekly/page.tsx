import { ReportView } from "@/components/reports/report-view"
import type { SearchParams } from "@/server/queries"

export const metadata = { title: "Weekly Reports" }

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <ReportView kind="weekly" searchParams={await searchParams} />
}
