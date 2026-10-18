import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// /auth/confirm behind a proxy. On Render, Next.js gives route handlers its INTERNAL address as
// request.url (http://localhost:10000/...), while the browser is on the public site. Redirects must be
// relative so the browser stays on the public address. Supabase is mocked: nothing here hits the network.
const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }))

const { GET, POST } = await import("@/app/auth/confirm/route")

const INTERNAL = "http://localhost:10000"
const PUBLIC_HOST = "seo-work.onrender.com"
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef01234567"

function get(query: string) {
  return GET(new NextRequest(`${INTERNAL}/auth/confirm${query}`, { headers: { host: PUBLIC_HOST, "x-forwarded-host": PUBLIC_HOST } }))
}
function post(fields: Record<string, string>, headers: Record<string, string> = { origin: `https://${PUBLIC_HOST}` }) {
  return POST(
    new NextRequest(`${INTERNAL}/auth/confirm`, {
      method: "POST",
      body: new URLSearchParams(fields),
      headers: { host: PUBLIC_HOST, "x-forwarded-host": PUBLIC_HOST, ...headers },
    }),
  )
}
/** Every redirect must be a relative in-app path: never localhost, another host or a protocol-relative URL. */
function location(res: Response) {
  const loc = res.headers.get("location") ?? ""
  expect(loc.startsWith("/") && !loc.startsWith("//"), `Location "${loc}" must be a relative in-app path`).toBe(true)
  expect(loc).not.toMatch(/localhost|10000|https?:/)
  return loc
}

beforeEach(() => {
  auth.verifyOtp.mockReset().mockResolvedValue({ error: null })
  auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null })
})

describe("GET /auth/confirm (emailed link opened)", () => {
  it("forwards a token link to the Continue page without spending the token", async () => {
    const res = await get(`?token_hash=${TOKEN}&type=recovery&next=/auth/set-password`)
    expect(res.status).toBe(307)
    const loc = new URL(location(res), "https://public.example")
    expect(loc.pathname).toBe("/auth/continue")
    expect(Object.fromEntries(loc.searchParams)).toEqual({ token_hash: TOKEN, type: "recovery", next: "/auth/set-password" })
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it.each([
    ["an external URL", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a tab-smuggled URL", "%2F%09%2Fevil.example"],
    ["nothing", ""],
  ])("keeps the default destination when next is %s", async (_label, next) => {
    const res = await get(`?token_hash=${TOKEN}&type=invite${next ? `&next=${next}` : ""}`)
    expect(new URL(location(res), "https://public.example").searchParams.get("next")).toBe("/auth/set-password")
  })

  it("PKCE code: success goes to the validated next path, failure to the sign-in error", async () => {
    expect(location(await get("?code=abc&next=/intern"))).toBe("/intern")
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc")
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid" } })
    expect(location(await get("?code=abc&next=/intern"))).toBe("/login?error=link")
    expect(location(await get("?code=abc&next=https://evil.example"))).toBe("/login?error=link")
  })

  it("a link without a token or code goes to the sign-in error", async () => {
    const res = await get("")
    expect(res.status).toBe(307)
    expect(location(res)).toBe("/login?error=link")
  })
})

describe("POST /auth/confirm (Continue pressed)", () => {
  it("verifies the token once and sends the user to set a password (303, relative)", async () => {
    const res = await post({ token_hash: TOKEN, type: "recovery", next: "/auth/set-password" })
    expect(res.status).toBe(303)
    expect(location(res)).toBe("/auth/set-password")
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1)
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: TOKEN })
  })

  it("an invalid or expired token ends on the sign-in error", async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } })
    const res = await post({ token_hash: TOKEN, type: "invite", next: "/auth/set-password" })
    expect(res.status).toBe(303)
    expect(location(res)).toBe("/login?error=link")
  })

  it("an unknown link type is refused without asking Supabase", async () => {
    expect(location(await post({ token_hash: TOKEN, type: "bogus" }))).toBe("/login?error=link")
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it("an unsafe next is replaced by the default after verification", async () => {
    expect(location(await post({ token_hash: TOKEN, type: "recovery", next: "https://evil.example" }))).toBe("/auth/set-password")
    expect(location(await post({ token_hash: TOKEN, type: "invite", next: "/\t/evil.example" }))).toBe("/auth/set-password")
  })

  it("accepts the form from the public site behind the proxy, refuses it from another site", async () => {
    expect((await post({ token_hash: TOKEN, type: "recovery" })).status).toBe(303)
    const forged = await post({ token_hash: TOKEN, type: "recovery" }, { origin: "https://evil.example" })
    expect(forged.status).toBe(403)
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1) // only the legitimate post reached Supabase
  })
})
