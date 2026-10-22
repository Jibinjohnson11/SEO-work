import { Plus } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { FilterBar } from "@/components/shared/filter-bar"
import { BrandGrid } from "@/components/admin/brand-grid"
import { ClientFormButton } from "@/components/admin/client-form"
import { getPresets, getSetting, param, type SearchParams } from "@/server/queries"
import { brandLogoUrls } from "@/server/brand-logos"
import type { Client } from "@/lib/types"

export const metadata = { title: "Brands" }

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { supabase } = await requireRole(["super_admin"])
  const status = param(sp, "status")
  let q = supabase.from("clients").select("*").order("company_name")
  if (["active", "paused", "archived"].includes(status)) q = q.eq("status", status)
  else q = q.neq("status", "archived")
  const [{ data }, general, approval, presets] = await Promise.all([
    q,
    getSetting("general"),
    getSetting("approval"),
    getPresets(supabase, "/admin/clients"),
  ])
  const clients = (data ?? []) as Client[]
  const logos = await brandLogoUrls(supabase, clients.map((c) => c.logo_path))
  const defaults = {
    timezone: general.default_timezone,
    client_approval_required: approval.client_approval_required,
    reapproval_on_material_change: approval.reapproval_on_material_change,
  }

  return (
    <>
      <PageHeader title="Brands" />
      <BrandGrid
        action={
          <ClientFormButton defaults={defaults} className="h-10 shrink-0 px-3">
            <Plus /> Add New Brand
          </ClientFormButton>
        }
        filters={
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
        }
        brands={clients.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.company_name,
          logoUrl: c.logo_path ? (logos.get(c.logo_path) ?? null) : null,
          industry: c.industry,
          country: c.country,
          website: c.website_url,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        }))}
        empty={{
          title: "No brands yet",
          description: "Create your first brand to start setting up campaigns.",
          action: (
            <ClientFormButton defaults={defaults}>
              <Plus /> New brand
            </ClientFormButton>
          ),
        }}
      />
    </>
  )
}
