import type { Tone } from "@/lib/workflow"
import type { SubmissionVersion } from "@/lib/types"

/**
 * Fields recorded in submission version snapshots, in display order. Must match
 * public._submission_material() / public._submission_snapshot() (20261019000016_submission_versioning.sql):
 * material fields decide whether a change can require client re-approval.
 */
export const VERSION_FIELDS: { key: string; label: string; material: boolean }[] = [
  { key: "proposed_website", label: "Proposed website", material: true },
  { key: "placement_url", label: "Placement URL", material: true },
  { key: "target_url", label: "Target URL", material: true },
  { key: "anchor_text", label: "Anchor text", material: true },
  { key: "content_title", label: "Content title", material: true },
  { key: "content_draft", label: "Content draft", material: true },
  { key: "link_attribute", label: "Link attribute", material: true },
  { key: "backlink_type_id", label: "Backlink type", material: true },
  { key: "keyword_id", label: "Keyword", material: true },
  { key: "website_relevance", label: "Website relevance", material: false },
  { key: "notes", label: "Notes", material: false },
  { key: "domain_rating", label: "Domain rating", material: false },
  { key: "domain_authority", label: "Domain authority", material: false },
  { key: "estimated_traffic", label: "Estimated traffic", material: false },
  { key: "outreach_contact", label: "Outreach contact", material: false },
  { key: "outreach_status", label: "Outreach status", material: false },
  { key: "task_id", label: "Task", material: false },
]

/** Fields worth showing as text in a version's details (ids are shown elsewhere by name). */
export const VERSION_DISPLAY_FIELDS = VERSION_FIELDS.filter((f) => !f.key.endsWith("_id"))

type VersionLike = Pick<SubmissionVersion, "change_type" | "is_material_change" | "snapshot">

/** How a version came about. Versions written before change_type existed fall back to is_material_change. */
export function versionChange(v: VersionLike, isFirst: boolean): { label: string; tone: Tone } {
  switch (v.change_type) {
    case "initial":
      return { label: "Initial version", tone: "muted" }
    case "material":
      return { label: "Material change", tone: "warning" }
    case "minor":
      return { label: "Minor revision", tone: "info" }
    case "unchanged":
      return { label: "Resubmitted without changes", tone: "muted" }
    default:
      if (isFirst) return { label: "Initial version", tone: "muted" }
      return v.is_material_change ? { label: "Material change", tone: "warning" } : { label: "Revision", tone: "info" }
  }
}

/**
 * Labels of fields that differ from the previous version. A field missing from either snapshot
 * (versions written before complete snapshots) is reported as not recorded, never as unchanged.
 */
export function changedFields(v: VersionLike, prev: VersionLike) {
  const changed: string[] = []
  let notRecorded = false
  for (const f of VERSION_FIELDS) {
    const inNew = Object.prototype.hasOwnProperty.call(v.snapshot, f.key)
    const inPrev = Object.prototype.hasOwnProperty.call(prev.snapshot, f.key)
    if (!inNew || !inPrev) {
      if (inNew !== inPrev) notRecorded = true
      continue
    }
    if (JSON.stringify(v.snapshot[f.key] ?? null) !== JSON.stringify(prev.snapshot[f.key] ?? null)) changed.push(f.label)
  }
  return { changed, notRecorded }
}
