import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { changedFields, VERSION_FIELDS, versionChange } from "@/lib/versions"

const v = (change_type: string | null, snapshot: Record<string, string | number | null>, is_material_change = true) =>
  ({ change_type, is_material_change, snapshot }) as Parameters<typeof versionChange>[0]

describe("version change labels", () => {
  it.each([
    ["initial", "Initial version"],
    ["material", "Material change"],
    ["minor", "Minor revision"],
    ["unchanged", "Resubmitted without changes"],
  ])("%s → %s", (type, label) => {
    expect(versionChange(v(type, {}), false).label).toBe(label)
  })

  it("legacy versions (no change_type) fall back to is_material_change", () => {
    expect(versionChange(v(null, {}), true).label).toBe("Initial version")
    expect(versionChange(v(null, {}, true), false).label).toBe("Material change")
    expect(versionChange(v(null, {}, false), false).label).toBe("Revision")
  })
})

describe("changed fields between versions", () => {
  const base = { anchor_text: "a", content_draft: "d", link_attribute: "dofollow", website_relevance: "r", domain_rating: 50 }

  it("lists material and non-material changes by label", () => {
    expect(changedFields(v("minor", { ...base, website_relevance: "r2" }), v("initial", base))).toEqual({ changed: ["Website relevance"], notRecorded: false })
    expect(changedFields(v("material", { ...base, link_attribute: "nofollow" }), v("initial", base)).changed).toEqual(["Link attribute"])
  })

  it("an unchanged resubmission reports no changes", () => {
    expect(changedFields(v("unchanged", base), v("initial", base))).toEqual({ changed: [], notRecorded: false })
  })

  it("fields missing from a legacy snapshot are reported as not recorded, not as unchanged", () => {
    const legacy = { anchor_text: "a", content_draft: "d", link_attribute: "dofollow" }
    expect(changedFields(v("minor", base), v(null, legacy))).toEqual({ changed: [], notRecorded: true })
  })

  it("compares numbers and strings exactly", () => {
    expect(changedFields(v("minor", { ...base, domain_rating: 51 }), v("initial", base)).changed).toEqual(["Domain rating"])
  })
})

describe("field list matches the database", () => {
  it("material and snapshot keys equal those in 20261019000016_submission_versioning.sql", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261019000016_submission_versioning.sql"), "utf8")
    const keysIn = (fn: string) => {
      const body = sql.slice(sql.indexOf(`function public.${fn}(`)).split("$$")[1]
      return [...body.matchAll(/'([a-z_]+)', s\./g)].map((m) => m[1])
    }
    const material = keysIn("_submission_material")
    const other = keysIn("_submission_snapshot")
    expect(VERSION_FIELDS.filter((f) => f.material).map((f) => f.key).sort()).toEqual([...material].sort())
    expect(VERSION_FIELDS.filter((f) => !f.material).map((f) => f.key).sort()).toEqual([...other].sort())
  })
})
