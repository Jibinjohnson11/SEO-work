import Link from "next/link"
import { Plus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { ToneBadge } from "@/components/shared/status-badge"
import { ClientFormButton } from "@/components/admin/client-form"
import { formatDay } from "@/lib/format"
import { getPresets, getSetting, param, type SearchParams } from "@/server/queries"
import type { Client } from "@/lib/types"

export const metadata = { title: "Clients" }

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const status = param(sp, "status")
  let q = supabase.from("clients").select("*").order("company_name")
  if (["active", "paused", "archived"].includes(status)) q = q.eq("status", status)
  else q = q.neq("status", "archived")
  const [{ data }, campaigns, members, general, approval, presets] = await Promise.all([
    q,
    supabase.from("campaigns").select("client_id, status"),
    supabase.from("client_members").select("client_id"),
    getSetting("general"),
    getSetting("approval"),
    getPresets(supabase, "/admin/clients"),
  ])
  const clients = (data ?? []) as Client[]
  const count = (rows: { client_id: string }[] | null, id: string, pred?: (r: { client_id: string; status?: string }) => boolean) =>
    (rows ?? []).filter((r) => r.client_id === id && (!pred || pred(r))).length
  const defaults = {
    timezone: general.default_timezone,
    internal_review_required: approval.internal_review_required,
    client_approval_required: approval.client_approval_required,
    reapproval_on_material_change: approval.reapproval_on_material_change,
  }

  return (
    <>
      <PageHeader
        title="Clients"
        description="Each client has an isolated workspace, approval rules and portal settings."
        actions={
          <ClientFormButton defaults={defaults}>
            <Plus /> New client
          </ClientFormButton>
        }
      />
      <FilterBar
        presets={presets}
        filters={[
          { type: "select", key: "status", label: "Status", allLabel: "Active & paused", options: [
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
            { value: "archived", label: "Archived" },
          ] },
        ]}
      />
      <DataTable
        searchPlaceholder="Search clients…"
        columns={[
          { key: "client", header: "Client", sortable: true },
          { key: "industry", header: "Industry", sortable: true },
          { key: "contact", header: "Contact" },
          { key: "campaigns", header: "Active campaigns", sortable: true, align: "right" },
          { key: "users", header: "Portal users", sortable: true, align: "right" },
          { key: "rules", header: "Workflow" },
          { key: "start", header: "Start date", sortable: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={clients.map((c) => ({
          id: c.id,
          search: `${c.code} ${c.company_name} ${c.industry ?? ""} ${c.contact_person ?? ""} ${c.contact_email ?? ""} ${c.country ?? ""}`,
          sort: {
            client: c.company_name,
            industry: c.industry,
            campaigns: count(campaigns.data, c.id, (r) => r.status === "active"),
            users: count(members.data, c.id),
            start: c.start_date,
            status: c.status,
          },
          cells: {
            client: (
              <Link href={`/admin/clients/${c.id}`} className="group block">
                <span className="font-medium group-hover:text-primary">{c.company_name}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.code}
                  {c.website_url ? ` · ${c.website_url.replace(/^https?:\/\//, "")}` : ""}
                </span>
              </Link>
            ),
            industry: c.industry,
            contact: c.contact_person ? (
              <span className="text-sm">
                {c.contact_person}
                <span className="block text-xs text-muted-foreground">{c.contact_email}</span>
              </span>
            ) : null,
            campaigns: count(campaigns.data, c.id, (r) => r.status === "active"),
            users: count(members.data, c.id),
            rules: (
              <span className="flex flex-wrap gap-1">
                {c.is_medical ? <ToneBadge tone="warning">Medical</ToneBadge> : null}
                {c.require_internal_review ? <ToneBadge tone="neutral">Internal review</ToneBadge> : null}
                {c.require_client_approval ? <ToneBadge tone="neutral">Client approval</ToneBadge> : null}
              </span>
            ),
            start: formatDay(c.start_date, general.date_format),
            status: <ToneBadge tone={c.status === "active" ? "success" : c.status === "paused" ? "warning" : "muted"}>{c.status[0].toUpperCase() + c.status.slice(1)}</ToneBadge>,
          },
        }))}
        empty={{
          title: "No clients yet",
          description: "Create your first client to start setting up campaigns.",
          action: (
            <ClientFormButton defaults={defaults}>
              <Plus /> New client
            </ClientFormButton>
          ),
        }}
      />
    </>
  )
}
