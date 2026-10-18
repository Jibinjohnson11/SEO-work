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
    // valid in-app destinations are kept exactly
    ["/admin/clients", "/admin/clients"],
    ["/auth/set-password", "/auth/set-password"],
    ["/access", "/access"],
    ["/intern/submissions/3f0c2a9e-1b2c-4d5e-8f90-123456789abc", "/intern/submissions/3f0c2a9e-1b2c-4d5e-8f90-123456789abc"],
    ["/admin/users?status=pending&q=a%20b", "/admin/users?status=pending&q=a%20b"],
    ["/portal/reports#latest", "/portal/reports#latest"],
    ["/admin/verification?q=https://publisher.example/page", "/admin/verification?q=https://publisher.example/page"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"], // percent-encoded: stays a path on this site
    ["/", "/"],
  ])("keeps %s", (input, expected) => expect(safeRedirectPath(input)).toBe(expected))

  it.each([
    // external and protocol-relative URLs
    "https://evil.com",
    "http://evil.com/admin",
    "//evil.com",
    "///evil.com",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "evil.com/admin",
    "admin",
    // characters browsers strip or rewrite, which would turn the path into //evil.com
    "/\tevil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\r\n/evil.com",
    "\t//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "\\\\evil.com",
    // other control, whitespace and invisible characters
    "/\u0000/evil.com",
    "/\u001f/evil.com",
    "/\u007f/evil.com",
    "/ /evil.com",
    "/admin clients",
    "/\u00a0/evil.com",
    "/\u200b/evil.com",
    "/\u2028/evil.com",
    "/\u202e/evil.com",
    "/\ufeff/evil.com",
    // empty and oversized
    "",
    "/" + "a".repeat(2048),
  ])("refuses %j", (input) => expect(safeRedirectPath(input, "/fallback")).toBe("/fallback"))

  it("falls back for null and undefined", () => {
    expect(safeRedirectPath(null)).toBe("/")
    expect(safeRedirectPath(undefined, "/auth/set-password")).toBe("/auth/set-password")
  })

  it("never lets an accepted value resolve to another origin (as browsers resolve it)", () => {
    for (let c = 0; c <= 0xffff; c++) {
      const candidate = `/${String.fromCharCode(c)}/evil.com`
      const out = safeRedirectPath(candidate, "/fallback")
      expect(new URL(out, "https://app.linkops.example").origin, JSON.stringify(candidate)).toBe("https://app.linkops.example")
    }
  })
})
