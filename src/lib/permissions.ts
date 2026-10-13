// Feature catalog for role-based access control. Keys are stored in profiles.permissions and
// public.role_permissions, and checked in the database (public.has_permission) as well as in
// every page, server action and route handler. Keep in sync with
// supabase/migrations/20261014000009_access_control.sql (tests/db/access.test.ts checks this).

import type { AppRole } from "@/lib/types"

export type AssignableRole = Exclude<AppRole, "super_admin">

export interface FeatureDef {
  key: string
  label: string
  description: string
  /** Another feature that must also be enabled for this one to be useful. */
  requires?: string
}

export const FEATURES = {
  intern: [
    { key: "intern.dashboard", label: "My Dashboard", description: "Overview of their tasks, submissions and targets." },
    { key: "intern.tasks", label: "My Tasks", description: "See assigned tasks and update task status." },
    { key: "intern.campaigns", label: "My Campaigns", description: "Campaigns they are assigned to, with keywords and target URLs." },
    { key: "intern.submissions", label: "My Submissions", description: "View their backlink submissions and review feedback." },
    {
      key: "intern.submissions.manage",
      label: "Create & edit submissions",
      description: "Submit new backlinks, edit drafts, upload files and record publication.",
      requires: "intern.submissions",
    },
    { key: "intern.performance", label: "My Performance", description: "Their own performance metrics and target completion." },
    { key: "intern.notifications", label: "Notifications", description: "In-app notifications." },
  ],
  client: [
    { key: "portal.overview", label: "Overview", description: "Workspace summary with campaign progress and pending approvals." },
    { key: "portal.approvals", label: "Approvals", description: "View content waiting for their approval." },
    {
      key: "portal.approvals.decide",
      label: "Approve or reject content",
      description: "Record approval decisions (the workspace “Can approve” setting must also allow it).",
      requires: "portal.approvals",
    },
    { key: "portal.campaigns", label: "Campaigns", description: "Campaign list and progress." },
    { key: "portal.published", label: "Published Backlinks", description: "Live backlinks and their verification status." },
    { key: "portal.reports", label: "Reports", description: "Published reports for their workspace." },
    {
      key: "portal.reports.download",
      label: "Download reports",
      description: "Export reports as PDF / Excel / CSV (the workspace download setting must also allow it).",
      requires: "portal.reports",
    },
    { key: "portal.notifications", label: "Notifications", description: "In-app notifications." },
  ],
} as const satisfies Record<AssignableRole, readonly FeatureDef[]>

export type Feature = (typeof FEATURES)[AssignableRole][number]["key"]

export const ALL_FEATURES: Feature[] = [...FEATURES.intern, ...FEATURES.client].map((f) => f.key)

export const ROLE_LABELS: Record<AppRole, string> = { super_admin: "Super Admin", intern: "Intern", client: "Client" }

/**
 * Effective permissions of a user: ["*"] for a Super Admin, otherwise the feature keys they may
 * use. Comes from public.my_permissions() so the app and the database agree.
 */
export type Permissions = readonly string[]

export function can(permissions: Permissions | null | undefined, feature: Feature) {
  return !!permissions && (permissions.includes("*") || permissions.includes(feature))
}

/** Keeps only valid keys for the role, and drops features whose prerequisite is not enabled. */
export function sanitizeFeatures(role: AssignableRole, keys: readonly string[]): Feature[] {
  const defs: readonly FeatureDef[] = FEATURES[role]
  const wanted = new Set(keys)
  return defs.filter((f) => wanted.has(f.key) && (!f.requires || wanted.has(f.requires))).map((f) => f.key as Feature)
}
