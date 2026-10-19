import { Check, Minus, ShieldAlert } from "lucide-react"
import { DetailList, Section } from "@/components/shared/page-header"
import { LiveStatusBadge, SubmissionStatusBadge, ToneBadge } from "@/components/shared/status-badge"
import { formatDateTime, formatDay } from "@/lib/format"
import { humanize, SUBMISSION_STATUS } from "@/lib/workflow"
import { changedFields, VERSION_DISPLAY_FIELDS, versionChange } from "@/lib/versions"
import type { SubmissionDetail } from "@/server/submission-detail"

const ext = (url: string | null | undefined) =>
  url ? (
    <a href={url} target="_blank" rel="noreferrer noopener nofollow" className="break-all text-primary hover:underline">
      {url}
    </a>
  ) : (
    "—"
  )

export function SubmissionContent({ d, showInternal }: { d: SubmissionDetail; showInternal: boolean }) {
  const s = d.submission
  return (
    <Section title="Submission" description={`Version ${s.current_version || "— (draft)"}`}>
      <DetailList
        items={[
          { label: "Client", value: s.clients.company_name },
          { label: "Campaign", value: `${s.campaigns.code} · ${s.campaigns.name}` },
          { label: "Keyword", value: s.keywords?.keyword ?? "—" },
          { label: "Backlink type", value: s.backlink_types.name },
          { label: "Task", value: s.tasks ? `${s.tasks.code} · ${s.tasks.title}` : "—" },
          { label: "Proposed website", value: ext(s.proposed_website.startsWith("http") ? s.proposed_website : `https://${s.proposed_website}`) },
          { label: "Proposed placement URL", value: ext(s.placement_url) },
          { label: "Target URL", value: ext(s.target_url) },
          { label: "Anchor text", value: s.anchor_text ?? "—" },
          { label: "Link attribute (expected)", value: s.link_attribute ?? "—" },
          { label: "Domain rating / authority", value: s.domain_rating || s.domain_authority ? `DR ${s.domain_rating ?? "—"} · DA ${s.domain_authority ?? "—"} (third-party estimates)` : "—" },
          { label: "Estimated traffic", value: s.estimated_traffic?.toLocaleString() ?? "—" },
          { label: "Website relevance", value: s.website_relevance ?? "—" },
          ...(showInternal
            ? [
                { label: "Outreach", value: s.outreach_contact ? `${s.outreach_contact}${s.outreach_status ? ` · ${humanize(s.outreach_status)}` : ""}` : "—" },
                { label: "Submission notes", value: s.notes ?? "—" },
              ]
            : []),
          { label: "First submitted", value: formatDateTime(s.first_submitted_at, s.clients.timezone) },
        ]}
      />
      {s.content_title || s.content_draft ? (
        <div className="mt-5 space-y-2 border-t pt-4">
          <h3 className="text-base font-semibold">{s.content_title ?? "Untitled draft"}</h3>
          <div className="max-h-[32rem] overflow-y-auto rounded-lg bg-muted/40 p-4 text-sm leading-relaxed whitespace-pre-wrap">{s.content_draft ?? "No content draft."}</div>
        </div>
      ) : null}
    </Section>
  )
}

export function VersionHistory({ d, timeZone }: { d: SubmissionDetail; timeZone: string }) {
  if (d.versions.length === 0) return null
  return (
    <Section title="Version history" description="Each submitted change is preserved. Approvals apply to a specific version.">
      <ol className="space-y-3">
        {d.versions.map((v, i) => {
          const prev = d.versions[i + 1]
          const diff = prev ? changedFields(v, prev) : null
          const change = versionChange(v, !prev)
          const approvals = d.approvals.filter((a) => a.version === v.version)
          return (
            <li key={v.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  Version {v.version} {v.version === d.submission.current_version ? <ToneBadge tone="info">Current</ToneBadge> : null}
                  {prev ? <ToneBadge tone={change.tone} className="ml-1">{change.label}</ToneBadge> : null}
                  {approvals.map((a) => (
                    <ToneBadge key={a.id} tone={a.decision === "approved" ? (a.is_admin_override ? "warning" : "success") : "danger"} className="ml-1">
                      {a.is_admin_override ? "Admin override" : `Client ${humanize(a.decision).toLowerCase()}`}
                    </ToneBadge>
                  ))}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(v.created_at, timeZone)}</span>
              </div>
              {v.change_summary ? <p className="mt-1 text-muted-foreground">{v.change_summary}</p> : null}
              {diff ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Changed: {diff.changed.length ? diff.changed.join(", ") : "nothing"}
                  {diff.notRecorded ? " (some fields were not recorded in the earlier version)" : ""}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Initial version</p>
              )}
              {v.approval_carried_from ? (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Client approval of version {v.approval_carried_from} carried forward: the campaign does not require re-approval after changes.
                </p>
              ) : null}
              {i > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-primary">View this version</summary>
                  <dl className="mt-2 space-y-2 text-xs">
                    {VERSION_DISPLAY_FIELDS.filter((f) => f.key in v.snapshot).map(({ key: k, label: l }) => (
                      <div key={k}>
                        <dt className="font-medium text-muted-foreground">{l}</dt>
                        <dd className="whitespace-pre-wrap">{v.snapshot[k] ?? "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

type TimelineItem = { at: string; title: React.ReactNode; body?: React.ReactNode; tone?: "default" | "warning" }

export function Timeline({ d, timeZone, internal }: { d: SubmissionDetail; timeZone: string; internal: boolean }) {
  const items: TimelineItem[] = [
    ...d.events.map((e) => ({
      at: e.occurred_at,
      title: (
        <span className="flex flex-wrap items-center gap-1.5">
          Status → <SubmissionStatusBadge status={e.to_status} />
          {e.version ? <span className="text-xs text-muted-foreground">v{e.version}</span> : null}
        </span>
      ),
      body: e.note,
    })),
    ...(internal
      ? d.reviews.map((r) => ({
          at: r.created_at,
          title: <span>Internal review by <strong>{r.reviewer_name}</strong>: {humanize(r.decision)} (v{r.version})</span>,
          body: (
            <>
              {r.comments ? <p>{r.comments}</p> : null}
              {r.medical_accuracy_reviewed !== null ? (
                <p className="mt-1 text-xs">
                  Medical review: accuracy {r.medical_accuracy_reviewed ? "✓" : "✗"} · claims {r.claims_verified ? "✓" : "✗"} · sources {r.sources_checked ? "✓" : "✗"} — {r.medical_reviewer_name}
                  {r.medical_reviewer_qualification ? ` (${r.medical_reviewer_qualification})` : ""} on {formatDay(r.medical_review_date)}
                  {r.compliance_notes ? ` · ${r.compliance_notes}` : ""}
                </p>
              ) : null}
            </>
          ),
        }))
      : []),
    ...d.approvals.map((a) => ({
      at: a.created_at,
      tone: a.is_admin_override ? ("warning" as const) : ("default" as const),
      title: a.is_admin_override ? (
        <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><ShieldAlert className="size-4" /> Admin override by {a.decided_by_name} (v{a.version}) — not a client approval</span>
      ) : (
        <span>Client decision by <strong>{a.decided_by_name}</strong>: {humanize(a.decision)} (v{a.version})</span>
      ),
      body: a.feedback,
    })),
  ].sort((x, y) => x.at.localeCompare(y.at))

  return (
    <Section title="Activity & decisions">
      <ol className="relative space-y-4 border-l pl-5">
        {items.map((it, i) => (
          <li key={i} className="relative text-sm">
            <span className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card ${it.tone === "warning" ? "bg-amber-500" : "bg-primary/70"}`} />
            <div>{it.title}</div>
            <div className="text-xs text-muted-foreground">{formatDateTime(it.at, timeZone)}</div>
            {it.body ? <div className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">{it.body}</div> : null}
          </li>
        ))}
      </ol>
    </Section>
  )
}

export function PublicationPanel({ d, timeZone, actions }: { d: SubmissionDetail; timeZone: string; actions?: React.ReactNode }) {
  const p = d.published
  if (!p) return null
  return (
    <Section title="Publication & verification" actions={actions}>
      <DetailList
        items={[
          { label: "Published URL", value: ext(p.published_url) },
          { label: "Publication date", value: formatDay(p.publication_date) },
          { label: "Publisher domain", value: p.publisher_domain },
          { label: "Link attribute", value: p.link_attribute },
          { label: "Live status", value: <LiveStatusBadge status={p.live_status} /> },
          { label: "Last checked", value: formatDateTime(p.last_checked_at, timeZone) },
        ]}
      />
      {d.checks.length ? (
        <div className="mt-4 overflow-x-auto border-t pt-3">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="py-1 text-left font-medium">Checked</th><th className="py-1 text-left font-medium">Method</th><th className="py-1 text-left font-medium">Result</th><th className="py-1 text-left font-medium">HTTP</th><th className="py-1 text-left font-medium">Link</th><th className="py-1 text-left font-medium">Anchor / rel</th><th className="py-1 text-left font-medium">Notes</th></tr>
            </thead>
            <tbody>
              {d.checks.map((c) => (
                <tr key={c.id} className="border-t align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{formatDateTime(c.checked_at, timeZone)}</td>
                  <td className="py-1.5 pr-2">{c.method}</td>
                  <td className="py-1.5 pr-2"><ToneBadge tone={c.result === "live" ? "success" : c.result === "changed" || c.result === "inconclusive" ? "warning" : "danger"}>{c.result}</ToneBadge></td>
                  <td className="py-1.5 pr-2">{c.http_status ?? "—"}</td>
                  <td className="py-1.5 pr-2">{c.link_found === null ? <Minus className="size-3" /> : c.link_found ? <Check className="size-3 text-success" /> : "✗"}</td>
                  <td className="py-1.5 pr-2">{c.found_anchor_text ?? "—"}{c.found_rel?.length ? ` · ${c.found_rel.join(" ")}` : ""}</td>
                  <td className="max-w-64 py-1.5">{c.error ?? c.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Not verified yet — published links are counted as verified only after a successful check.</p>
      )}
    </Section>
  )
}

export function StageSummary({ d }: { d: SubmissionDetail }) {
  const s = d.submission
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <SubmissionStatusBadge status={s.status} />
      <span className="text-muted-foreground">Stage: {SUBMISSION_STATUS[s.status].stage}</span>
      {d.flags.is_medical ? <ToneBadge tone="warning">Medical review</ToneBadge> : null}
      {!d.flags.require_internal_review ? <ToneBadge tone="muted">No internal review</ToneBadge> : null}
      {!d.flags.require_client_approval ? <ToneBadge tone="muted">No client approval</ToneBadge> : null}
    </div>
  )
}
