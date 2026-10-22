import "server-only"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import { PageHeader, Section } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { FilterBar } from "@/components/shared/filter-bar"
import { ToneBadge } from "@/components/shared/status-badge"
import { ContentRowActions, ContentSubmitForm, CreateContentButton, type ContentOptions } from "@/components/admin/offpage-content-forms"
import {
  CONTENT_EDITABLE,
  CONTENT_STATUS,
  CONTENT_TYPES,
  type ContentDecision,
  type ContentStatus,
  type ContentVersion,
  type OffpageContent,
} from "@/lib/offpage-content"
import { formatDateTime } from "@/lib/format"
import { sanitizeRichText } from "@/lib/rich-text"
import { getLookups, getSetting, labelMaps, param, type SearchParams } from "@/server/queries"

/**
 * Off-Page Content form + list, shared by /admin/page-content (all content, any campaign) and
 * /intern/content (the team member's own content, for campaigns they are assigned to). RLS decides
 * which rows each user reads; the database functions enforce the same rules on submit.
 */
export async function ContentWorkspace({
  supabase,
  sp,
  mine,
  header,
}: {
  supabase: SupabaseClient
  sp: SearchParams
  mine?: { userId: string }
  /** When given, renders the page header with "+ Create New Content" (form in a modal) instead of the inline form. */
  header?: { title: string; description: string }
}) {
  const status = param(sp, "status")
  let q = supabase.from("offpage_contents").select("*").order("submitted_at", { ascending: false }).limit(1000)
  if (status in CONTENT_STATUS) q = q.eq("status", status)
  if (mine) q = q.eq("submitted_by", mine.userId)
  // Notification links point at one item: ?q=CNT-00012
  const code = /^CNT-\d{5,}$/.test(param(sp, "q")) ? param(sp, "q") : ""
  if (code) q = q.eq("code", code)
  const [lookups, reports, typeLinks, kwLinks, assigned, { data }] = await Promise.all([
    getLookups(supabase),
    getSetting("reports"),
    supabase.from("campaign_backlink_types").select("campaign_id, backlink_type_id"),
    supabase.from("campaign_keywords").select("campaign_id, keyword_id, is_primary"),
    mine ? supabase.from("intern_assignments").select("campaign_id").eq("intern_id", mine.userId).eq("is_active", true) : Promise.resolve({ data: null }),
    q,
  ])
  const contents = ((data ?? []) as OffpageContent[]).map((c) => ({ ...c, content_html: sanitizeRichText(c.content_html) }))
  const ids = contents.map((c) => c.id)
  const chunks = Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, i * 150 + 150))
  const [versionRes, decisionRes] = await Promise.all([
    Promise.all(chunks.map((c) => supabase.from("offpage_content_versions").select("content_id, version, title, content_html, created_at").in("content_id", c).order("version", { ascending: false }))),
    Promise.all(chunks.map((c) => supabase.from("offpage_content_decisions").select("content_id, version, decision, feedback, decided_by_name, created_at, is_admin_override").in("content_id", c).order("created_at", { ascending: false }))),
  ])
  const group = <T extends { content_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) m.set(r.content_id, [...(m.get(r.content_id) ?? []), r])
    return m
  }
  const versions = group(versionRes.flatMap((r) => (r.data ?? []) as ContentVersion[]))
  const decisions = group(decisionRes.flatMap((r) => (r.data ?? []) as ContentDecision[]))

  const labels = labelMaps(lookups)
  const authorIds = [...new Set(contents.map((c) => c.submitted_by))]
  const { data: authors } = authorIds.length ? await supabase.from("profiles").select("id, full_name, email").in("id", authorIds) : { data: [] }
  const authorName = Object.fromEntries((authors ?? []).map((a) => [a.id, a.full_name || a.email]))

  const campaignTypes = new Map<string, string[]>()
  for (const l of typeLinks.data ?? []) campaignTypes.set(l.campaign_id, [...(campaignTypes.get(l.campaign_id) ?? []), l.backlink_type_id])
  // The campaign's own primary / secondary keywords (Campaigns module), primary first.
  const campaignKeywords = new Map<string, { id: string; keyword: string; primary: boolean }[]>()
  for (const l of kwLinks.data ?? []) {
    if (!labels.keyword[l.keyword_id]) continue
    campaignKeywords.set(l.campaign_id, [...(campaignKeywords.get(l.campaign_id) ?? []), { id: l.keyword_id, keyword: labels.keyword[l.keyword_id], primary: l.is_primary }])
  }
  for (const list of campaignKeywords.values()) list.sort((a, b) => Number(b.primary) - Number(a.primary) || a.keyword.localeCompare(b.keyword))
  const campaignOption = (c: (typeof lookups.campaigns)[number]) => ({
    id: c.id,
    label: `${c.code} · ${c.name}`,
    brand: labels.client[c.client_id] ?? "—",
    type_ids: campaignTypes.get(c.id) ?? [],
    keywords: campaignKeywords.get(c.id) ?? [],
  })
  const assignedIds = assigned.data ? new Set(assigned.data.map((a) => a.campaign_id as string)) : null
  const options: ContentOptions = {
    campaigns: lookups.campaigns.filter((c) => (c.status === "active" || c.status === "draft") && (!assignedIds || assignedIds.has(c.id))).map(campaignOption),
    types: lookups.types.filter((t) => t.is_active).map((t) => ({ id: t.id, name: t.name })),
  }
  // Content linked to a campaign or type that is no longer offered stays editable.
  const editOptions = (c: OffpageContent): ContentOptions => {
    const campaign = lookups.campaigns.find((x) => x.id === c.campaign_id)
    const type = lookups.types.find((x) => x.id === c.backlink_type_id)
    return {
      campaigns: options.campaigns.some((x) => x.id === c.campaign_id) || !campaign ? options.campaigns : [campaignOption(campaign), ...options.campaigns],
      types: options.types.some((x) => x.id === c.backlink_type_id) || !type ? options.types : [{ id: type.id, name: type.name }, ...options.types],
    }
  }
  const tz = reports.timezone

  return (
    <>
      {header ? (
        <PageHeader title={header.title} description={header.description} actions={<CreateContentButton options={options} />} />
      ) : (
        <Section title="Submit content" description="Campaign → Keyword → Backlink type → Content type → Title → Content → client approval">
          <ContentSubmitForm options={options} />
        </Section>
      )}

      {contents.length >= 1000 ? <p className="text-xs text-muted-foreground">Showing the 1,000 most recently submitted. Filter by status to see older content.</p> : null}
      {code ? (
        <p className="text-sm text-muted-foreground">
          Showing {code} · <Link href="?" className="text-primary hover:underline">Show all content</Link>
        </p>
      ) : null}
      <FilterBar
        filters={[{ type: "select", key: "status", label: "Status", options: (Object.keys(CONTENT_STATUS) as ContentStatus[]).map((s) => ({ value: s, label: CONTENT_STATUS[s].label })) }]}
      />
      <DataTable cards={{ title: "campaign", badge: "status", actions: "actions" }}
        searchPlaceholder="Search content…"
        columns={[
          { key: "campaign", header: "Content / Campaign", sortable: true },
          { key: "keyword", header: "Keyword", sortable: true },
          { key: "type", header: "Backlink Type", sortable: true },
          { key: "ctype", header: "Content Type", sortable: true },
          ...(mine ? [] : [{ key: "author", header: "Submitted By", sortable: true }]),
          { key: "date", header: "Date", sortable: true },
          { key: "status", header: "Status", sortable: true },
          { key: "actions", header: "", className: "w-20" },
        ]}
        rows={contents.map((c) => {
          const campaign = labels.campaignName[c.campaign_id] ?? "Unknown"
          const type = labels.backlink_type[c.backlink_type_id] ?? "Unknown"
          const keyword = labels.keyword[c.keyword_id] ?? "Unknown"
          const primary = campaignKeywords.get(c.campaign_id)?.find((k) => k.id === c.keyword_id)?.primary
          const author = authorName[c.submitted_by] ?? "—"
          const st = CONTENT_STATUS[c.status]
          return {
            id: c.id,
            search: `${c.code} ${c.title} ${keyword} ${campaign} ${labels.client[c.client_id] ?? ""} ${type} ${CONTENT_TYPES[c.content_type]} ${author}`,
            sort: { campaign: c.title, keyword, type, ctype: CONTENT_TYPES[c.content_type], author, date: c.submitted_at, status: st.label },
            cells: {
              campaign: <span className="block max-w-64"><span className="font-medium">{c.title}</span><span className="block text-xs text-muted-foreground">{c.code} · {campaign} · {labels.client[c.client_id]}</span></span>,
              keyword: <span className="block max-w-48">{keyword}{primary !== undefined ? <span className="block text-xs text-muted-foreground">{primary ? "Primary" : "Secondary"}</span> : null}</span>,
              type,
              ctype: CONTENT_TYPES[c.content_type],
              author,
              date: <span className="whitespace-nowrap">{formatDateTime(c.submitted_at, tz)}</span>,
              status: (
                <span className="flex flex-col items-start gap-1">
                  <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
                  <span className="text-xs text-muted-foreground">v{c.current_version}{c.approved_version ? ` · approved v${c.approved_version}` : ""}</span>
                </span>
              ),
              actions: (
                <ContentRowActions
                  content={c}
                  options={editOptions(c)}
                  versions={versions.get(c.id) ?? []}
                  decisions={decisions.get(c.id) ?? []}
                  canEdit={CONTENT_EDITABLE.includes(c.status)}
                  details={[
                    { label: "Brand", value: labels.client[c.client_id] ?? "—" },
                    { label: "Campaign", value: campaign },
                    { label: "Target keyword", value: primary === undefined ? keyword : `${keyword} (${primary ? "primary" : "secondary"})` },
                    { label: "Backlink type", value: type },
                    { label: "Content type", value: CONTENT_TYPES[c.content_type] },
                    { label: "Status", value: st.label },
                    { label: "Submitted by", value: author },
                    { label: "Last submitted", value: formatDateTime(c.submitted_at, tz) },
                    { label: "Approved version", value: c.approved_version ? `v${c.approved_version}` : "—" },
                  ]}
                />
              ),
            },
          }
        })}
        empty={
          header
            ? { title: "No content yet", description: "Create content for a campaign backlink; it goes to the client for approval.", action: <CreateContentButton options={options} /> }
            : { title: "No content yet", description: "Content you submit with the form above will appear here." }
        }
      />
    </>
  )
}
