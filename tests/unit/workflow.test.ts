import { describe, expect, it } from "vitest"
import { availableActions, SUBMISSION_STATUS, SUBMISSION_STATUSES } from "@/lib/workflow"
import { safeRedirectPath } from "@/lib/url"

describe("availableActions", () => {
  it("interns can only edit/submit their own returned work and publish approved work", () => {
    expect(availableActions("intern", "draft", { isOwner: true })).toEqual(["edit", "submit"])
    expect(availableActions("intern", "draft", { isOwner: false })).toEqual([])
    expect(availableActions("intern", "submitted", { isOwner: true })).toEqual([])
    expect(availableActions("intern", "client_approved", { isOwner: true })).toEqual(["publish"])
    expect(availableActions("intern", "awaiting_client_approval", { isOwner: true })).toEqual([])
  })
  it("clients only decide on items awaiting their approval when allowed", () => {
    expect(availableActions("client", "awaiting_client_approval", { canApprove: true })).toEqual(["client_decide"])
    expect(availableActions("client", "awaiting_client_approval", { canApprove: false })).toEqual([])
    expect(availableActions("client", "client_approved", { canApprove: true })).toEqual([])
  })
  it("admin override appears only when enabled", () => {
    expect(availableActions("super_admin", "awaiting_client_approval")).not.toContain("override")
    expect(availableActions("super_admin", "awaiting_client_approval", { allowOverride: true })).toContain("override")
  })
  it("every status has display metadata", () => {
    for (const s of SUBMISSION_STATUSES) expect(SUBMISSION_STATUS[s].label).toBeTruthy()
    expect(SUBMISSION_STATUSES).toHaveLength(16)
  })
})

describe("safeRedirectPath", () => {
  it.each([
    ["/admin/clients", "/admin/clients"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    ["/\\evil.com", "/"],
    [null, "/"],
  ])("%s → %s", (input, expected) => expect(safeRedirectPath(input)).toBe(expected))
})
