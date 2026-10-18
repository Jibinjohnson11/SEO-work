import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeSupabase } from "./support/fake-supabase"

// inviteUser / resendInvite against an in-memory Supabase (tests/unit/support/fake-supabase.ts) that
// enforces the real uniqueness and foreign-key rules. Nothing here touches a database or sends email.
const h = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof import("./support/fake-supabase").fakeSupabase> }))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/app-url", () => ({ appOrigin: async () => "https://app.test" }))
vi.mock("@/lib/auth", () => ({
  ActionError: class ActionError extends Error {},
  authorize: async () => ({ userId: "admin-1", supabase: h.fake.client }),
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.fake.client }))

const { inviteUser, resendInvite } = await import("@/server/admin/users")

const CAMPAIGN = "3f0c2a9e-1b2c-4d5e-8f90-123456789abc"
const CLIENT = "3f0c2a9e-1b2c-4d5e-8f90-123456789abd"
const base = { email: "Person@resend.dev", job_title: "", joining_date: "", daily_target: 1, weekly_target: 5, monthly_target: 20, can_approve: true, can_download_reports: true }
const intern = (name = "A") => ({ ...base, full_name: name, role: "intern" as const, campaign_ids: [CAMPAIGN], client_id: "" })
const client = (name = "B") => ({ ...base, full_name: name, role: "client" as const, campaign_ids: [], client_id: CLIENT })
const CONCURRENT = "This address was just invited by someone else. Refresh the page to see it."

let errors: unknown[][]
beforeEach(() => {
  h.fake = fakeSupabase()
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "")
  errors = []
  vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a))
})

const s = () => h.fake.state
const account = () => s().users.filter((u) => u.email === "person@resend.dev")
const profiles = () => s().tables.profiles
function addAccount(extra: Partial<(typeof s.prototype)["users"]> & Record<string, unknown> = {}) {
  s().users.push({ id: "existing-1", email: "person@resend.dev", email_confirmed_at: null, last_sign_in_at: null, app_metadata: {}, created_at: "2026-10-01T00:00:00Z", ...extra })
}
/** Exactly one account, one profile, and the account's role marker agrees with that profile. */
function expectOneConsistentUser() {
  expect(account()).toHaveLength(1)
  expect(profiles()).toHaveLength(1)
  expect(profiles()[0].id).toBe(account()[0].id)
  expect(account()[0].app_metadata.role).toBe(profiles()[0].role)
}

describe("single invitations (onboarding workflow unchanged)", () => {
  it("new address: one account, its profile and assignment, then exactly one invitation email", async () => {
    const r = await inviteUser(intern())
    expect(r).toMatchObject({ ok: true, message: "Invitation sent" })
    expectOneConsistentUser()
    expect(profiles()[0]).toMatchObject({ role: "intern", status: "invited", email: "person@resend.dev" })
    expect(s().tables.intern_assignments).toHaveLength(1)
    expect(s().emails).toEqual([{ kind: "invite", to: "person@resend.dev" }])
    expect(s().log.at(-1)).toBe("email invite") // sent last
  })

  it("existing unconfirmed account without a profile: linked (same id) and re-invited", async () => {
    addAccount()
    expect(await inviteUser(intern())).toMatchObject({ ok: true, data: "existing-1", message: "Invitation sent to the existing sign-in account" })
    expectOneConsistentUser()
    expect(s().emails).toEqual([{ kind: "invite", to: "person@resend.dev" }])
  })

  it("existing confirmed account without a profile: linked and sent a password-setup link", async () => {
    addAccount({ email_confirmed_at: "2026-10-02T00:00:00Z" })
    const r = await inviteUser(intern())
    expect(r.ok && r.message).toMatch(/password setup email/)
    expectOneConsistentUser()
    expect(s().emails).toEqual([{ kind: "recovery", to: "person@resend.dev" }])
  })
})

describe("duplicate requests", () => {
  it("a second invitation after the first succeeded is refused and changes nothing", async () => {
    await inviteUser(client())
    const snapshot = structuredClone({ users: s().users, tables: s().tables })
    expect(await inviteUser(intern())).toMatchObject({ ok: false, error: "A user with this email already exists" })
    expect({ users: s().users, tables: s().tables }).toEqual(snapshot)
    expect(s().emails).toHaveLength(1)
  })

  it("an existing user's role, permissions, workspace and assignments are never touched", async () => {
    addAccount({ email_confirmed_at: "2026-10-02T00:00:00Z", app_metadata: { role: "client" } })
    profiles().push({ id: "existing-1", email: "person@resend.dev", role: "client", status: "active", permissions: ["approvals.view"] })
    s().tables.client_members.push({ client_id: CLIENT, user_id: "existing-1" })
    const snapshot = structuredClone({ users: s().users, tables: s().tables })
    for (const r of await Promise.all([inviteUser(intern("A")), inviteUser(client("B"))])) expect(r.ok).toBe(false)
    expect({ users: s().users, tables: s().tables }).toEqual(snapshot)
    expect(s().emails).toEqual([])
  })
})

describe("simultaneous invitations of the same address", () => {
  it("new address, same role: one account, one profile, one email; the other is told it lost", async () => {
    const results = await Promise.all([inviteUser(intern("A")), inviteUser(intern("B"))])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)).toMatchObject({ error: CONCURRENT })
    expectOneConsistentUser()
    expect(s().emails).toHaveLength(1)
    expect(s().tables.intern_assignments).toHaveLength(1)
  })

  it("new address, different roles: the winner's role, workspace and assignments are the only ones kept", async () => {
    const [a, b] = await Promise.all([inviteUser(intern("A")), inviteUser(client("B"))])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expectOneConsistentUser()
    const winner = profiles()[0].role
    expect(s().tables.client_members).toHaveLength(winner === "client" ? 1 : 0)
    expect(s().tables.intern_assignments).toHaveLength(winner === "intern" ? 1 : 0)
    expect(s().emails).toHaveLength(1)
  })

  it.each([
    ["unconfirmed", null, "invite"],
    ["confirmed", "2026-10-02T00:00:00Z", "recovery"],
  ])("existing %s account without a profile: linked once, one %s email, never deleted", async (_l, confirmedAt, kind) => {
    addAccount({ email_confirmed_at: confirmedAt })
    const results = await Promise.all([inviteUser(intern("A")), inviteUser(client("B")), inviteUser(intern("C"))])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expectOneConsistentUser()
    expect(account()[0].id).toBe("existing-1")
    expect(s().emails).toEqual([{ kind, to: "person@resend.dev" }])
    expect(s().log.join()).not.toContain("deleteUser attempt")
  })

  it("the invitation that created the account but lost the claim leaves the account to the winner", async () => {
    // A creates the account, then pauses; B finds it ("already registered"), claims it and finishes.
    let releaseA!: () => void
    const aPaused = new Promise<void>((r) => (releaseA = r))
    s().hooks["insert profiles"] = async (row) => {
      if (row.full_name === "A") await aPaused
    }
    const a = inviteUser(intern("A"))
    await vi.waitFor(() => expect(s().log).toContain("create account acct-1"))
    const b = await inviteUser(client("B"))
    releaseA()
    expect(b).toMatchObject({ ok: true, message: "Invitation sent to the existing sign-in account" })
    expect(await a).toMatchObject({ ok: false, error: CONCURRENT })
    expectOneConsistentUser()
    expect(profiles()[0]).toMatchObject({ full_name: "B", role: "client" })
    expect(s().tables.client_members).toHaveLength(1)
    expect(s().log.join()).not.toContain("deleteUser attempt")
  })

  it("a loser never restores or overwrites the winner's role marker", async () => {
    addAccount({ app_metadata: { role: "client" } }) // stale marker from an earlier, removed profile
    let releaseB!: () => void
    s().hooks["insert profiles"] = async (row) => {
      if (row.full_name === "B") await new Promise<void>((r) => (releaseB = r))
    }
    const b = inviteUser(intern("B"))
    await vi.waitFor(() => expect(releaseB).toBeTypeOf("function"))
    expect(await inviteUser(intern("A"))).toMatchObject({ ok: true })
    releaseB()
    expect(await b).toMatchObject({ ok: false, error: CONCURRENT })
    expect(account()[0].app_metadata.role).toBe("intern")
    expect(s().log.filter((l) => l.startsWith("role "))).toEqual(["role existing-1=intern"]) // only the winner wrote it
  })
})

describe("rollback after the claim", () => {
  it("email failure on a new address: everything removed, including the account it created; a retry then works", async () => {
    s().fail.inviteUserByEmail = { message: "SMTP unavailable" }
    expect(await inviteUser(intern())).toMatchObject({ ok: false, error: "Invitation failed: SMTP unavailable" })
    expect(account()).toHaveLength(0)
    expect(profiles()).toHaveLength(0)
    expect(s().tables.intern_assignments).toHaveLength(0)
    s().fail.inviteUserByEmail = undefined
    expect(await inviteUser(intern())).toMatchObject({ ok: true })
    expectOneConsistentUser()
  })

  it("email failure on an existing account: its previous marker is restored BEFORE the claim is released, and it is kept", async () => {
    addAccount({ app_metadata: { role: "client" } })
    s().fail.inviteUserByEmail = { message: "SMTP unavailable" }
    expect((await inviteUser(intern())).ok).toBe(false)
    expect(account()).toHaveLength(1)
    expect(account()[0].app_metadata.role).toBe("client")
    expect(profiles()).toHaveLength(0)
    const log = s().log
    expect(log.indexOf("role existing-1=client")).toBeLessThan(log.indexOf("delete profiles (1)"))
  })

  it("workspace link failure: only this invitation's rows are undone, and no email is sent", async () => {
    s().fail["insert client_members"] = { message: "violates foreign key", code: "23503" }
    expect((await inviteUser(client())).ok).toBe(false)
    expect(profiles()).toHaveLength(0)
    expect(account()).toHaveLength(0)
    expect(s().emails).toEqual([])
  })

  it("a failed rollback step keeps the account (never deletes one a profile still references) and is reported", async () => {
    s().fail.inviteUserByEmail = { message: "SMTP unavailable" }
    s().fail["delete profiles"] = { message: "connection reset" }
    expect((await inviteUser(intern())).ok).toBe(false)
    expect(account()).toHaveLength(1)
    expect(profiles()).toHaveLength(1)
    expect(s().log.join()).not.toContain("deleteUser attempt")
    expect(JSON.stringify(errors)).toContain("rollback incomplete")
  })

  it("the role marker cannot be restored: the claim is still released only after trying, and the failure is reported", async () => {
    addAccount({ app_metadata: { role: "client" } })
    s().fail.inviteUserByEmail = { message: "SMTP unavailable" }
    s().fail["updateUserById client"] = { message: "Auth API timeout" }
    expect((await inviteUser(intern())).ok).toBe(false)
    expect(account()).toHaveLength(1) // existing account: never deleted
    expect(JSON.stringify(errors)).toContain("role marker: Auth API timeout")
  })

  it("a concurrent invitation that arrives after a failed winner rolled back can succeed cleanly", async () => {
    let first = true
    s().hooks.inviteUserByEmail = () => {
      if (first) {
        first = false
        s().fail.inviteUserByEmail = { message: "SMTP unavailable" }
      } else s().fail.inviteUserByEmail = undefined
    }
    const r1 = await inviteUser(intern("A"))
    const r2 = await inviteUser(client("B"))
    expect(r1.ok).toBe(false)
    expect(r2).toMatchObject({ ok: true })
    expectOneConsistentUser()
    expect(profiles()[0].role).toBe("client")
  })
})

describe("refusals before anything is created", () => {
  it("Super Admin accounts and addresses outside the staging allowlist", async () => {
    addAccount({ app_metadata: { role: "super_admin" } })
    expect((await inviteUser(intern())).ok).toBe(false)
    vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "@resend.dev")
    expect(await inviteUser({ ...intern(), email: "client@real-company.com" })).toMatchObject({ ok: false, error: "This test environment only sends email to approved test addresses." })
    expect(profiles()).toHaveLength(0)
    expect(s().users).toHaveLength(1)
    expect(s().emails).toEqual([])
  })
})

describe("resendInvite (expired or lost invitations)", () => {
  const PROFILE = "3f0c2a9e-1b2c-4d5e-8f90-123456789abc"
  const seed = (confirmedAt: string | null, status = "invited") => {
    s().users.push({ id: PROFILE, email: "person@resend.dev", email_confirmed_at: confirmedAt, last_sign_in_at: null, app_metadata: { role: "intern" }, created_at: "2026-10-01T00:00:00Z" })
    profiles().push({ id: PROFILE, email: "person@resend.dev", role: "intern", status })
  }
  it("re-sends an invitation to an unconfirmed account", async () => {
    seed(null)
    expect(await resendInvite(PROFILE)).toMatchObject({ ok: true, message: "Invitation re-sent" })
    expect(s().emails).toEqual([{ kind: "invite", to: "person@resend.dev" }])
  })
  it("sends a password-setup link when the account is already confirmed", async () => {
    seed("2026-10-02T00:00:00Z")
    expect(await resendInvite(PROFILE)).toMatchObject({ ok: true, message: "Password setup email sent (this address is already confirmed)" })
    expect(s().emails).toEqual([{ kind: "recovery", to: "person@resend.dev" }])
  })
  it("refuses users who already accepted", async () => {
    seed(null, "active")
    expect((await resendInvite(PROFILE)).ok).toBe(false)
    expect(s().emails).toEqual([])
  })
})
