import { afterEach, describe, expect, it } from "vitest"
import { clientIpFrom, trustedIpSource } from "@/lib/client-ip"

// The rate limiter must only trust client-IP headers a proxy in front of the app controls.

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
const setUserAgent = (ua: string) => Object.defineProperty(globalThis, "navigator", { value: { userAgent: ua }, configurable: true })
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator)
})

describe("trusted client-IP source", () => {
  it("an unknown host has no trusted source: no shared 'unknown' bucket and no spoofable guesses", () => {
    setUserAgent("Node.js")
    expect(trustedIpSource({})).toBeNull()
    const spoofed = headers({ "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "6.6.6.6", "x-real-ip": "6.6.6.6" })
    expect(clientIpFrom(spoofed, trustedIpSource({}))).toBeNull()
  })

  it("on Vercel, uses x-real-ip (which Vercel overwrites) and ignores cf-connecting-ip", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "203.0.113.7", "cf-connecting-ip": "6.6.6.6" }), trustedIpSource({ VERCEL: "1" }))).toBe("203.0.113.7")
  })

  it("uses cf-connecting-ip only when actually running on Cloudflare Workers", () => {
    setUserAgent("Cloudflare-Workers")
    expect(clientIpFrom(headers({ "cf-connecting-ip": "198.51.100.9" }), trustedIpSource({}))).toBe("198.51.100.9")
  })

  it("an explicitly configured single-value header is used as-is", () => {
    const src = trustedIpSource({ CLIENT_IP_HEADER: "True-Client-IP" })
    expect(src).toEqual({ header: "true-client-ip", mode: "single", hops: 1 })
    expect(clientIpFrom(headers({ "true-client-ip": "2001:db8::1" }), src)).toBe("2001:db8::1")
  })
})

describe("spoofing attempts are rejected", () => {
  it("X-Forwarded-For: client-supplied leftmost entries are ignored; the proxy-appended entry is used", () => {
    const src = trustedIpSource({ CLIENT_IP_HEADER: "x-forwarded-for" })
    // The client sent "X-Forwarded-For: 6.6.6.6"; our proxy appended the real address.
    expect(clientIpFrom(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.50" }), src)).toBe("203.0.113.50")
  })

  it("X-Forwarded-For behind two trusted proxies takes the second entry from the right", () => {
    const src = trustedIpSource({ CLIENT_IP_HEADER: "x-forwarded-for", TRUSTED_PROXY_HOPS: "2" })
    expect(clientIpFrom(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.50, 10.0.0.2" }), src)).toBe("203.0.113.50")
  })

  it("values that are not IP addresses are rejected (no unlimited fresh rate-limit keys)", () => {
    const src = trustedIpSource({ CLIENT_IP_HEADER: "x-real-ip" })
    for (const v of ["unknown", "attacker-123", "1.2.3.4; drop", "", "999.1.1.1"]) expect(clientIpFrom(headers({ "x-real-ip": v }), src)).toBeNull()
  })

  it("a missing header yields no IP instead of a shared bucket", () => {
    expect(clientIpFrom(headers({}), trustedIpSource({ CLIENT_IP_HEADER: "x-real-ip" }))).toBeNull()
  })

  it("TRUSTED_PROXY_HOPS cannot be set below one", () => {
    expect(trustedIpSource({ CLIENT_IP_HEADER: "x-forwarded-for", TRUSTED_PROXY_HOPS: "0" })?.hops).toBe(1)
    expect(trustedIpSource({ CLIENT_IP_HEADER: "x-forwarded-for", TRUSTED_PROXY_HOPS: "abc" })?.hops).toBe(1)
  })
})
