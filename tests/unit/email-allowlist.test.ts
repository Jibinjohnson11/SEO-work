import { describe, expect, it } from "vitest"
import { assertAllowedRecipients, EmailRecipientBlockedError, isAllowedRecipient, parseAllowlist } from "@/lib/email-allowlist"

describe("email recipient allowlist", () => {
  const list = parseAllowlist("@resend.dev, QA@Example.org")

  it("is unrestricted when unset (production)", () => {
    expect(parseAllowlist(undefined)).toBeNull()
    expect(parseAllowlist(" , ")).toBeNull()
    expect(isAllowedRecipient("client@real-company.com", null)).toBe(true)
  })

  it("matches whole domains and exact addresses, ignoring case", () => {
    expect(isAllowedRecipient("delivered+linkops-x@resend.dev", list)).toBe(true)
    expect(isAllowedRecipient("Delivered@RESEND.dev", list)).toBe(true)
    expect(isAllowedRecipient("qa@example.org", list)).toBe(true)
    expect(isAllowedRecipient("other@example.org", list)).toBe(false)
  })

  it("does not match look-alike domains or malformed addresses", () => {
    expect(isAllowedRecipient("a@sub.resend.dev", list)).toBe(false)
    expect(isAllowedRecipient("a@resend.dev.evil.com", list)).toBe(false)
    expect(isAllowedRecipient("a@notresend.dev", list)).toBe(false)
    expect(isAllowedRecipient("resend.dev", list)).toBe(false)
    expect(isAllowedRecipient("x@evil.com@resend.dev", parseAllowlist("@evil.com"))).toBe(false)
  })

  it("refuses the whole message when any recipient is outside it, without naming the address", () => {
    expect(() => assertAllowedRecipients(["a@resend.dev"], list)).not.toThrow()
    const err = (() => {
      try {
        assertAllowedRecipients(["a@resend.dev", "client@real-company.com"], list)
      } catch (e) {
        return e as Error
      }
    })()
    expect(err).toBeInstanceOf(EmailRecipientBlockedError)
    expect(err?.message).not.toContain("real-company")
  })
})
