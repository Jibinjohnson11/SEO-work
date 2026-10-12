import { notFound } from "next/navigation"
import { ShieldAlert } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { DetailList, PageHeader, Section } from "@/components/shared/page-header"
import { LiveStatusBadge, SubmissionStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { DecisionPanel } from "@/components/portal/decision-panel"
import { formatDateTime, formatDay } from "@/lib/format"
import { humanize } from "@/lib/workflow"
import { portalClients } from "@/server/portal"
import type { LiveStatus, ReviewDecision, SubmissionStatus } from "@/lib/types"

interface PortalDetail {
  id: string
  code: string
  status: SubmissionStatus
  current_version: number
  client_approved_version: number | null
  campaign: { code: string; name: string }
  keyword: string | null
  backlink_type: string
  proposed_website: string
  placement_url: string | null
  target_url: string
  anchor_text: string | null
  content_title: string | null
  content_draft: string | null
  link_attribute: string | null
  submitted_at: string | null
  domain_rating: number | null
  domain_authority: number | null
  can_approve: boolean
  versions: { version: number; snapshot: Record<string, string | null>; created_at: string; change_summary: string | null }[]
  decisions: { version: number; decision: ReviewDecision; feedback: string | null; decided_by_name: string; is_admin_override: boolean; created_at: string }[]
  published: { published_url: string; publication_date: string; live_status: LiveStatus; last_checked_at: string | null } | null
}

const link = (u: string | null) => (u ? <a href={u.startsWith("http") ? u : `https://${u}`} target="_blank" rel="noreferrer noopener nofollow" className="break-all text-primary hover:underline">{u}</a> : "—")

export default async function PortalReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const { supabase } = await requireRole(["client"])
  const { data, error } = await supabase.rpc("client_portal_submission", { p_id: id })
  if (error || !data) notFound()
  const d = data as PortalDetail
  const tz = (await portalClients(supabase))[0]?.timezone ?? "UTC"
  const prev = d.versions.find((v) => v.version === d.client_approved_version)
  const changedSinceApproval = prev && d.client_approved_version !== d.current_version
    ? (["content_title", "content_draft", "anchor_text", "target_url", "placement_url", "proposed_website"] as const).filter((k) => (prev.snapshot[k] ?? null) !== (d.versions[0]?.snapshot[k] ?? null))
    : []

  return (
    <>
      <PageHeader title={d.content_title ?? d.proposed_website} description={<span className="flex flex-wrap items-center gap-2">{d.code} · {d.campaign.name} <SubmissionStatusBadge status={d.status} /></span>} />
      {d.status === "awaiting_client_approval" && d.can_approve ? (
        <Section title="Your decision" className="border-primary/40">
          {changedSinceApproval.length ? <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">This content was revised after you approved version {d.client_approved_version}. Changed: {changedSinceApproval.map(humanize).join(", ")}.</p> : null}
          <DecisionPanel submissionId={d.id} version={d.current_version} />
        </Section>
      ) : d.status === "awaiting_client_approval" ? (
        <p className="text-sm text-muted-foreground">You can view this item but your account is not allowed to approve content.</p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Section title="Placement">
            <DetailList items={[
              { label: "Campaign", value: `${d.campaign.code} · ${d.campaign.name}` },
              { label: "Keyword", value: d.keyword ?? "—" },
              { label: "Backlink type", value: d.backlink_type },
              { label: "Proposed website", value: link(d.proposed_website) },
              { label: "Proposed placement", value: link(d.placement_url) },
              { label: "Target URL (your page)", value: link(d.target_url) },
              { label: "Anchor text", value: d.anchor_text ?? "—" },
              ...(d.domain_rating !== null || d.domain_authority !== null ? [{ label: "Domain metrics (third-party estimates)", value: `DR ${d.domain_rating ?? "—"} · DA ${d.domain_authority ?? "—"}` }] : []),
              { label: "Submitted", value: formatDateTime(d.submitted_at, tz) },
            ]} />
          </Section>
          {d.content_title || d.content_draft ? (
            <Section title="Content" description={`Version ${d.current_version}`}>
              <h3 className="mb-3 text-lg font-semibold">{d.content_title}</h3>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{d.content_draft}</div>
            </Section>
          ) : null}
          {d.published ? (
            <Section title="Publication">
              <DetailList items={[
                { label: "Live URL", value: link(d.published.published_url) },
                { label: "Published", value: formatDay(d.published.publication_date) },
                { label: "Verification", value: <LiveStatusBadge status={d.published.live_status} /> },
                { label: "Last checked", value: formatDateTime(d.published.last_checked_at, tz) },
              ]} />
            </Section>
          ) : null}
        </div>
        <div className="space-y-6">
          <Section title="Decision history">
            {d.decisions.length === 0 ? <p className="text-sm text-muted-foreground">No decisions yet.</p> : (
              <ul className="space-y-3 text-sm">
                {d.decisions.map((x, i) => (
                  <li key={i} className="rounded-lg border p-3">
                    {x.is_admin_override ? (
                      <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300"><ShieldAlert className="size-4" /> Agency override (not your approval)</div>
                    ) : (
                      <div className="font-medium">{x.decided_by_name}: <ToneBadge tone={x.decision === "approved" ? "success" : x.decision === "rejected" ? "danger" : "warning"}>{humanize(x.decision)}</ToneBadge></div>
                    )}
                    <div className="text-xs text-muted-foreground">Version {x.version} · {formatDateTime(x.created_at, tz)}</div>
                    {x.feedback ? <p className="mt-1 whitespace-pre-wrap">{x.feedback}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {d.versions.length > 1 ? (
            <Section title="Versions">
              <ul className="space-y-2 text-sm">
                {d.versions.map((v) => (
                  <li key={v.version}>
                    <details>
                      <summary className="cursor-pointer">Version {v.version} · {formatDateTime(v.created_at, tz)}{v.version === d.current_version ? " (current)" : ""}</summary>
                      {v.change_summary ? <p className="mt-1 text-xs text-muted-foreground">{v.change_summary}</p> : null}
                      <div className="mt-2 space-y-1 text-xs">
                        <p><span className="font-medium">Title:</span> {v.snapshot.content_title ?? "—"}</p>
                        <p><span className="font-medium">Anchor:</span> {v.snapshot.anchor_text ?? "—"}</p>
                        <p className="whitespace-pre-wrap"><span className="font-medium">Content:</span> {v.snapshot.content_draft ?? "—"}</p>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  )
}
