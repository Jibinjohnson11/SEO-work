import { describe, expect, it } from "vitest"
import { INVITE_REFUSALS, planInvite } from "@/lib/invite-plan"

const NOW = Date.parse("2026-10-17T12:00:00Z")
const account = (extra: Record<string, unknown> = {}) => ({ id: "auth-1", email_confirmed_at: null, last_sign_in_at: null, app_metadata: {}, ...extra })

describe("planInvite: what an invitation does for an address", () => {
  it("creates a new account when none exists", () => {
    expect(planInvite({ hasProfile: false, account: null, now: NOW })).toEqual({ kind: "create" })
  })
  it("refuses when a LinkOps profile already exists (no duplicate profile)", () => {
    expect(planInvite({ hasProfile: true, account: null, now: NOW })).toEqual({ kind: "refuse", reason: INVITE_REFUSALS.profileExists })
    expect(planInvite({ hasProfile: true, account: account(), now: NOW }).kind).toBe("refuse")
  })
  it("re-invites an existing, unconfirmed account without a profile (same id, no duplicate account)", () => {
    expect(planInvite({ hasProfile: false, account: account(), now: NOW })).toEqual({ kind: "reinvite", userId: "auth-1" })
  })
  it("sends a password-setup link to an existing confirmed account without a profile", () => {
    expect(planInvite({ hasProfile: false, account: account({ email_confirmed_at: "2026-10-17T10:00:00Z" }), now: NOW })).toEqual({ kind: "recover", userId: "auth-1" })
    expect(planInvite({ hasProfile: false, account: account({ confirmed_at: "2026-10-17T10:00:00Z" }), now: NOW }).kind).toBe("recover")
    expect(planInvite({ hasProfile: false, account: account({ last_sign_in_at: "2026-10-17T10:00:00Z" }), now: NOW }).kind).toBe("recover")
  })
  it("never turns a Super Admin account into an intern or client", () => {
    expect(planInvite({ hasProfile: false, account: account({ app_metadata: { role: "super_admin" } }), now: NOW })).toEqual({ kind: "refuse", reason: INVITE_REFUSALS.superAdmin })
  })
  it("refuses an account banned in Supabase Auth, but not one whose ban has expired", () => {
    expect(planInvite({ hasProfile: false, account: account({ banned_until: "2099-01-01T00:00:00Z" }), now: NOW })).toEqual({ kind: "refuse", reason: INVITE_REFUSALS.banned })
    expect(planInvite({ hasProfile: false, account: account({ banned_until: "2020-01-01T00:00:00Z" }), now: NOW }).kind).toBe("reinvite")
  })
})
