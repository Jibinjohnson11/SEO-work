import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { FilterBar } from "@/components/shared/filter-bar"
import { EmptyState } from "@/components/shared/empty-state"
import { ToneBadge } from "@/components/shared/status-badge"
import { formatDateTime } from "@/lib/format"
import { utcRange } from "@/lib/reporting"
import { getLookups, getSetting, param, resolvePeriod, searchTerm, type SearchParams } from "@/server/queries"
import type { ActivityLog } from "@/lib/types"

export const metadata = { title: "Activity Logs" }
const PAGE = 50
const ENTITY_LINK: Record<string, (id: string) => string> = {
  backlink_submissions: (id) => `/admin/submissions/${id}`,
  clients: (id) => `/admin/clients/${id}`,
  campaigns: (id) => `/admin/campaigns/${id}`,
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const [reports, lookups] = await Promise.all([getSetting("reports"), getLookups(supabase)])
  const page = Math.max(1, Number(param(sp, "page")) || 1)
  const { data: actors } = await supabase.from("profiles").select("id, full_name, email")
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name || a.email]))

  let q = supabase.from("activity_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1)
  const entity = param(sp, "entity")
  if (entity) q = q.eq("entity_type", entity)
  const actor = param(sp, "actor")
  if (/^[0-9a-f-]{36}$/.test(actor)) q = q.eq("actor_id", actor)
  const client = param(sp, "client")
  if (/^[0-9a-f-]{36}$/.test(client)) q = q.eq("client_id", client)
  const action = param(sp, "action")
  if (action === "auth") q = q.like("action", "auth.%")
  else if (action === "workflow") q = q.like("action", "submission.%")
  else if (action === "override") q = q.eq("action", "submission.admin_override")
  else if (action === "data") q = q.in("action", ["insert", "update", "delete"])
  const text = searchTerm(param(sp, "q"))
  if (text) q = q.or(`summary.ilike.%${text}%,entity_id.ilike.%${text}%`)
  if (param(sp, "period") || param(sp, "from")) {
    const p = resolvePeriod(sp, reports.timezone, "last_7")
    const r = utcRange(p.from, p.to, reports.timezone)
    q = q.gte("created_at", r.start.toISOString()).lt("created_at", r.end.toISOString())
  }
  const { data, count } = await q
  const logs = (data ?? []) as ActivityLog[]
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE))
  const pageHref = (n: number) => `/admin/activity?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))), page: String(n) })}`

  return (
    <>
      <PageHeader title="Activity Logs" description="Append-only audit trail of every data change, workflow decision and sign-in. Entries cannot be edited or deleted." />
      <FilterBar
        filters={[
          { type: "search", key: "q", label: "Search", placeholder: "Summary or record id" },
          { type: "period", presets: [{ value: "", label: "Any time" }, { value: "today", label: "Today" }, { value: "last_7", label: "Last 7 days" }, { value: "last_30", label: "Last 30 days" }, { value: "custom", label: "Custom range" }] },
          { type: "select", key: "action", label: "Kind", options: [{ value: "workflow", label: "Workflow decisions" }, { value: "override", label: "Admin overrides" }, { value: "data", label: "Data changes" }, { value: "auth", label: "Sign-ins" }] },
          { type: "select", key: "entity", label: "Record type", options: ["backlink_submissions", "clients", "campaigns", "keywords", "tasks", "profiles", "published_backlinks", "application_settings", "intern_assignments", "client_members", "backlink_types", "reports"].map((e) => ({ value: e, label: e.replace(/_/g, " ") })) },
          { type: "select", key: "actor", label: "User", options: (actors ?? []).map((a) => ({ value: a.id, label: a.full_name || a.email })) },
          { type: "select", key: "client", label: "Brand", options: lookups.clients.map((c) => ({ value: c.id, label: c.company_name })) },
        ]}
      />
      <div className="surface overflow-hidden">
        {logs.length === 0 ? <EmptyState title="No activity matches" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 text-left font-medium">When</th><th className="px-3 py-2 text-left font-medium">User</th><th className="px-3 py-2 text-left font-medium">Action</th><th className="px-3 py-2 text-left font-medium">Record</th><th className="px-3 py-2 text-left font-medium">Details</th></tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const link = l.entity_id && ENTITY_LINK[l.entity_type]?.(l.entity_id)
                  const changed = (l.metadata?.changed ?? null) as Record<string, unknown> | null
                  return (
                    <tr key={l.id} className="border-b align-top last:border-0">
                      <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(l.created_at, reports.timezone)}</td>
                      <td className="px-3 py-2 text-xs">{l.actor_id ? actorName.get(l.actor_id) ?? "Unknown" : <span className="text-muted-foreground">System</span>}{l.actor_role ? <span className="block text-muted-foreground">{l.actor_role.replace("_", " ")}</span> : null}</td>
                      <td className="px-3 py-2"><ToneBadge tone={l.action === "submission.admin_override" ? "warning" : l.action === "delete" ? "danger" : l.action.startsWith("submission.") ? "info" : "neutral"}>{l.action}</ToneBadge></td>
                      <td className="px-3 py-2 text-xs">{l.entity_type.replace(/_/g, " ")}{l.summary ? <span className="block font-medium text-foreground">{link ? <Link href={link} className="hover:text-primary">{l.summary}</Link> : l.summary}</span> : null}</td>
                      <td className="max-w-md px-3 py-2 text-xs text-muted-foreground">
                        {changed ? Object.entries(changed).map(([k, v]) => <span key={k} className="mr-2 inline-block"><span className="font-medium text-foreground">{k}</span>: {typeof v === "string" ? v : JSON.stringify(v)}</span>) : l.metadata && Object.keys(l.metadata).length ? <code className="break-all">{JSON.stringify(l.metadata)}</code> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{count ?? 0} entries</span>
        <span className="flex items-center gap-2">
          Page {page} of {pages}
          {page > 1 ? <Link className="rounded-md border p-1 hover:bg-muted" href={pageHref(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Link> : null}
          {page < pages ? <Link className="rounded-md border p-1 hover:bg-muted" href={pageHref(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Link> : null}
        </span>
      </div>
    </>
  )
}
