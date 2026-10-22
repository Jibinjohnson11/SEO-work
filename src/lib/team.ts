/**
 * Team roles are descriptive labels stored in profiles.job_title. They never grant access: what a
 * team member can open is decided by their account role and feature permissions (Users & Access).
 */
export const TEAM_ROLES = ["Admin", "Manager", "Faculty", "Reviewer", "Intern", "Student"] as const

/** Label shown for a team member; accounts without one are shown as "Intern" (their original role). */
export function teamRoleLabel(jobTitle: string | null | undefined) {
  return jobTitle?.trim() || "Intern"
}
