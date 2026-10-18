import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sendEmail } from "@/lib/email"
import { EmailRecipientBlockedError } from "@/lib/email-allowlist"

// The Resend API is mocked: nothing here sends email.
const KEY = "re_unit_test_key_never_real_0000"
const ok = () => new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
const fail = (status: number) => new Response(`{"message":"error ${status}"}`, { status })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", KEY)
  vi.stubEnv("EMAIL_FROM", "LinkOps Staging <onboarding@resend.dev>")
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "")
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.useFakeTimers({ toFake: ["setTimeout"] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const msg = { to: ["delivered@resend.dev"], subject: "S", text: "T", idempotencyKey: "key-1" }
async function settle<T>(p: Promise<T>) {
  const caught = p.then((v) => ({ v }), (e: Error) => ({ e }))
  await vi.runAllTimersAsync()
  return caught as Promise<{ v?: T; e?: Error }>
}
const headersOf = (call: number) => fetchMock.mock.calls[call][1].headers as Record<string, string>

describe("sendEmail (Resend API, mocked)", () => {
  it("is a no-op that reports false when email is not configured or there is no recipient", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    expect(await sendEmail(msg)).toBe(false)
    vi.stubEnv("RESEND_API_KEY", KEY)
    expect(await sendEmail({ ...msg, to: [] })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends from EMAIL_FROM with the idempotency key and returns the provider id", async () => {
    fetchMock.mockResolvedValueOnce(ok())
    expect(await sendEmail(msg)).toEqual({ id: "email-1" })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ from: "LinkOps Staging <onboarding@resend.dev>", to: ["delivered@resend.dev"], subject: "S", text: "T" })
    expect(headersOf(0)["Idempotency-Key"]).toBe("key-1")
  })

  it("refuses recipients outside the allowlist before contacting the provider", async () => {
    vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "@resend.dev")
    await expect(sendEmail({ ...msg, to: ["delivered@resend.dev", "client@real-company.com"] })).rejects.toBeInstanceOf(EmailRecipientBlockedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("retries once on a rate limit, with the same idempotency key (no duplicate)", async () => {
    fetchMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok())
    expect((await settle(sendEmail(msg))).v).toEqual({ id: "email-1" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(headersOf(1)["Idempotency-Key"]).toBe(headersOf(0)["Idempotency-Key"])
  })

  it("retries once on provider errors and network failures, then throws", async () => {
    fetchMock.mockResolvedValueOnce(fail(503)).mockRejectedValueOnce(new Error("socket hang up"))
    const r = await settle(sendEmail(msg))
    expect(r.e?.message).toBe("Email provider unreachable: socket hang up")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not retry other client errors, and never puts the key in the error", async () => {
    fetchMock.mockResolvedValueOnce(fail(422))
    const r = await settle(sendEmail(msg))
    expect(r.e?.message).toMatch(/^Email provider error 422/)
    expect(r.e?.message).not.toContain(KEY)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
