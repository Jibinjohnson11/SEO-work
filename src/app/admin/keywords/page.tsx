import { Plus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { PriorityBadge, ToneBadge } from "@/components/shared/status-badge"
import { KeywordBulkActions, KeywordFormButton, KeywordRowMenu, type KeywordOptions } from "@/components/admin/keyword-form"
import { ImportDialog } from "@/components/admin/import-dialog"
import { humanize } from "@/lib/workflow"
import { importKeywords } from "@/server/admin/keywords"
import { getLookups, getPresets, param, type SearchParams } from "@/server/queries"
import type { Keyword } from "@/lib/types"

export const metadata = { title: "Keywords" }

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const client = param(sp, "client")
  const campaign = param(sp, "campaign")
  const group = param(sp, "group")
  const status = param(sp, "status")
  let q = supabase.from("keywords").select("*").order("keyword")
  if (/^[0-9a-f-]{36}$/.test(client)) q = q.eq("client_id", client)
  if (group) q = q.eq("group_name", group)
  if (status) q = q.eq("status", status)
  else q = q.neq("status", "archived")
  const [{ data }, links, lookups, presets, groupsRes] = await Promise.all([
    q,
    supabase.from("campaign_keywords").select("campaign_id, keyword_id, is_primary"),
    getLookups(supabase),
    getPresets(supabase, "/admin/keywords"),
    supabase.from("keywords").select("group_name").not("group_name", "is", null),
  ])
  let keywords = (data ?? []) as Keyword[]
  const linkRows = links.data ?? []
  if (/^[0-9a-f-]{36}$/.test(campaign)) {
    const ids = new Set(linkRows.filter((l) => l.campaign_id === campaign).map((l) => l.keyword_id))
    keywords = keywords.filter((k) => ids.has(k.id))
  }
  const campaignLabel = Object.fromEntries(lookups.campaigns.map((c) => [c.id, c.code]))
  const clientLabel = Object.fromEntries(lookups.clients.map((c) => [c.id, c.company_name]))
  const groups = [...new Set((groupsRes.data ?? []).map((g) => g.group_name as string))].sort()
  const options: KeywordOptions = {
    clients: lookups.clients.filter((c) => c.status !== "archived").map((c) => ({ id: c.id, label: c.company_name })),
    campaigns: lookups.campaigns.filter((c) => c.status !== "archived").map((c) => ({ id: c.id, label: `${c.code} · ${c.name}`, client_id: c.client_id })),
    groups,
  }

  return (
    <>
      <PageHeader
        title="Keywords"
        description="Central keyword list. A keyword can be used by several campaigns of the same client."
        actions={
          <>
            <ImportDialog
              title="Import keywords"
              action={importKeywords}
              columns={["client", "keyword", "search_intent", "target_url", "priority", "group", "campaign_codes", "notes"]}
              example={["CL-001", "dental clinic kerala", "local", "https://client.com/", "high", "Clinic", "CMP-001;CMP-004", ""]}
            />
            <KeywordFormButton options={options}><Plus /> Add keyword</KeywordFormButton>
          </>
        }
      />
      <FilterBar
        presets={presets}
        filters={[
          { type: "select", key: "client", label: "Client", options: options.clients.map((c) => ({ value: c.id, label: c.label })) },
          { type: "select", key: "campaign", label: "Campaign", options: options.campaigns.filter((c) => !client || c.client_id === client).map((c) => ({ value: c.id, label: c.label })) },
          { type: "select", key: "group", label: "Group", options: groups.map((g) => ({ value: g, label: g })) },
          { type: "select", key: "status", label: "Status", allLabel: "Active & paused", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }, { value: "archived", label: "Archived" }] },
        ]}
      />
      <DataTable
        searchPlaceholder="Search keywords…"
        bulk={<KeywordBulkActions campaigns={options.campaigns} />}
        columns={[
          { key: "keyword", header: "Keyword", sortable: true },
          { key: "client", header: "Client", sortable: true },
          { key: "campaigns", header: "Campaigns" },
          { key: "intent", header: "Intent", sortable: true },
          { key: "target", header: "Target URL" },
          { key: "group", header: "Group", sortable: true },
          { key: "priority", header: "Priority", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "actions", header: "", className: "w-10" },
        ]}
        rows={keywords.map((k) => {
          const myLinks = linkRows.filter((l) => l.keyword_id === k.id)
          return {
            id: k.id,
            search: `${k.code} ${k.keyword} ${k.group_name ?? ""} ${clientLabel[k.client_id] ?? ""} ${myLinks.map((l) => campaignLabel[l.campaign_id]).join(" ")}`,
            sort: { keyword: k.keyword, client: clientLabel[k.client_id], intent: k.search_intent, group: k.group_name, priority: { urgent: 0, high: 1, medium: 2, low: 3 }[k.priority], status: k.status },
            cells: {
              keyword: <span className="font-medium">{k.keyword}<span className="block text-xs font-normal text-muted-foreground">{k.code}</span></span>,
              client: clientLabel[k.client_id],
              campaigns: myLinks.length ? (
                <span className="flex flex-wrap gap-1">
                  {myLinks.map((l) => <ToneBadge key={l.campaign_id} tone={l.is_primary ? "info" : "neutral"}>{campaignLabel[l.campaign_id]}</ToneBadge>)}
                </span>
              ) : <span className="text-xs text-muted-foreground">Unassigned</span>,
              intent: k.search_intent ? humanize(k.search_intent) : null,
              target: k.target_url ? <span className="block max-w-48 truncate text-xs">{k.target_url}</span> : null,
              group: k.group_name,
              priority: <PriorityBadge priority={k.priority} />,
              status: <ToneBadge tone={k.status === "active" ? "success" : "muted"}>{humanize(k.status)}</ToneBadge>,
              actions: <KeywordRowMenu keyword={k} campaignIds={myLinks.map((l) => l.campaign_id)} options={options} />,
            },
          }
        })}
        empty={{ title: "No keywords yet", description: "Add keywords one by one or import a spreadsheet." }}
      />
    </>
  )
}
