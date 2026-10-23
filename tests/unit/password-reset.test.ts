import { beforeEach, describe, expect, it, vi } from "vitest"

// requestPasswordReset with Supabase mocked: nothing here hits the network or sends email. Both the
// skipped-recipient and the Supabase-error paths must log safely and answer with the same generic
// message as a successful request, so the page never reveals whether an account exists.
const h = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("@/lib/app-url", () => ({ appOrigin: async () => "https://app.test" }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { resetPasswordForEmail: h.resetPasswordForEmail } }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.rpc }) }))

const { requestPasswordReset } = await import("@/server/auth-actions")

const GENERIC = { message: "If an account exists for that email, a reset link is on its way." }
const ALLOWED = "person@resend.dev"
const BLOCKED = "someone@client.example"

function submit(email: string) {
  const form = new FormData()
  form.set("email", email)
  return requestPasswordReset(undefined, form)
}

let logs: unknown[][]
beforeEach(() => {
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "@resend.dev")
  vi.stubEnv("CLIENT_IP_HEADER", "")
  h.resetPasswordForEmail.mockReset().mockResolvedValue({ data: {}, error: null })
  h.rpc.mockReset().mockResolvedValue({ data: true, error: null }) // under the rate limit
  logs = []
  vi.spyOn(console, "warn").mockImplementation((...a) => void logs.push(a))
  vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a))
})

/** No log line may contain either address (or any address at all). */
function expectNoAddressLogged() {
  const text = JSON.stringify(logs)
  expect(text).not.toContain(ALLOWED)
  expect(text).not.toContain(BLOCKED)
  expect(text).not.toMatch(/[^\s"]+@[^\s"]+\.[a-z]+/i)
}

describe("requestPasswordReset", () => {
  it("skips a recipient outside the allowlist, logs why, and answers generically", async () => {
    expect(await submit(BLOCKED)).toEqual(GENERIC)
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled()
    expect(logs).toEqual([["[resetPassword] skipped: recipient is not on EMAIL_ALLOWED_RECIPIENTS; nothing was sent"]])
    expectNoAddressLogged()
  })

  it("logs only the status and code of a Supabase error, and answers generically", async () => {
    h.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: Object.assign(new Error(`Error sending recovery email to ${ALLOWED}`), { status: 500, code: "unexpected_failure" }),
    })
    expect(await submit(ALLOWED)).toEqual(GENERIC)
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith(ALLOWED, { redirectTo: "https://app.test/auth/confirm?next=/auth/set-password" })
    expect(logs).toEqual([["[resetPassword] auth rejected", { status: 500, code: "unexpected_failure" }]])
    expectNoAddressLogged()
  })

  it("logs nothing when Supabase accepts the request", async () => {
    expect(await submit(ALLOWED)).toEqual(GENERIC)
    expect(h.resetPasswordForEmail).toHaveBeenCalledOnce()
    expect(logs).toEqual([])
  })

  it("still enforces the per-email rate limit before calling Supabase", async () => {
    h.rpc.mockResolvedValue({ data: false, error: null })
    expect(await submit(ALLOWED)).toEqual({ error: "Too many requests. Try again later." })
    expect(h.rpc).toHaveBeenCalledWith("check_rate_limit", { p_key: `reset:email:${ALLOWED}`, p_limit: 3, p_window_seconds: 3600 })
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled()
  })
})
