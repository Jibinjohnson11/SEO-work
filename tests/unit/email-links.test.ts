import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { collectLinkManually, parseEmailLink, redact, withTokenRedacted } from "../../e2e/support/email-links"
import { RUN } from "../../e2e/support/target"

// The checks applied to a real emailed link BEFORE it is opened (fake tokens only; nothing is sent).
const T = "0123456789abcdef0123456789abcdef0123456789abcdef01234567"
const good = (type = "invite") => `http://localhost:3100/auth/confirm?token_hash=${T}&type=${type}&next=/auth/set-password`

describe("emailed link shape", () => {
  it("accepts the LinkOps template link, also when HTML-escaped", () => {
    expect(parseEmailLink(good(), "invite")).toMatchObject({ token: T, type: "invite" })
    expect(parseEmailLink(good("recovery").replace(/&/g, "&amp;"), "recovery").token).toBe(T)
    expect(parseEmailLink(`  ${good()}\n`, "invite").type).toBe("invite")
    expect(parseEmailLink(good().replace(T, `pkce_${T}`), "invite").token).toBe(`pkce_${T}`)
  })

  it.each([
    ["https on another host", good().replace("http://localhost:3100", "https://localhost:3100")],
    ["another port", good().replace(":3100", ":3000")],
    ["Supabase's own verify endpoint", `https://flvdmarzdthbtobezxhn.supabase.co/auth/v1/verify?token=${T}&type=invite&redirect_to=http://localhost:3100`],
    ["a click-tracking redirect", `https://click.resend.example/r?u=${encodeURIComponent(good())}`],
    ["the production app", good().replace("http://localhost:3100", "https://seo-work.onrender.com")],
    ["a different path", good().replace("/auth/confirm", "/auth/continue")],
    ["the wrong type", good("recovery")],
    ["a foreign redirect", good().replace("next=/auth/set-password", "next=/admin")],
    ["an extra parameter", `${good()}&redirect_to=https://evil.example`],
    ["a duplicated token", `${good()}&token_hash=${T}`],
    ["a missing token", good().replace(`token_hash=${T}&`, "")],
    ["a malformed token", good().replace(T, "abc")],
    ["credentials in the URL", good().replace("http://", "http://user:pw@")],
    ["a fragment", `${good()}#access_token=x`],
    ["not a URL", "Accept invitation"],
  ])("refuses %s", (_label, link) => {
    expect(() => parseEmailLink(link, "invite")).toThrow(/Refusing|not a URL/)
  })

  it("never puts the token in its error message", () => {
    let message = ""
    try {
      parseEmailLink(good().replace("localhost:3100", "evil.example"), "invite")
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain("evil.example")
    expect(message).not.toContain(T)
  })
})

describe("token redaction", () => {
  it("removes raw and URL-encoded tokens", () => {
    expect(redact(`goto ${good()} failed; enc=${encodeURIComponent(`pkce_${T}`)}`, T)).not.toContain(T)
  })
  it("rethrows failures without the token in message or stack", async () => {
    const err = await withTokenRedacted(T, async () => {
      throw new Error(`Expected /intern, received ${good()}`)
    }).catch((e: Error) => e)
    expect(err.message).toContain("[token]")
    expect(`${err.message}${err.stack}`).not.toContain(T)
  })
})

describe("manual hand-over (file written by scripts/e2e-save-link.sh)", () => {
  const dir = join(tmpdir(), `linkops-e2e-links-${RUN}`)

  it("reads the link once, validates it and deletes the file and folder", async () => {
    setTimeout(() => writeFileSync(join(dir, "unit.url"), good("recovery") + "\n"), 200)
    const link = await collectLinkManually({ label: "unit", recipient: "delivered+unit@resend.dev", type: "recovery", timeoutMs: 10_000 })
    expect(link.token).toBe(T)
    expect(existsSync(dir)).toBe(false)
  })

  it("announces itself to the save script with a WAITING marker naming the label", async () => {
    let marker = ""
    setTimeout(() => {
      marker = readFileSync(join(dir, "WAITING"), "utf8").trim()
      writeFileSync(join(dir, "marker.url"), good())
    }, 200)
    await collectLinkManually({ label: "marker", recipient: "x@resend.dev", type: "invite", timeoutMs: 10_000 })
    expect(marker).toBe("marker")
  })

  it("ignores invalid input and keeps waiting, so a bad paste does not end the test", async () => {
    setTimeout(() => writeFileSync(join(dir, "retry.url"), "pbpaste > '/some/path'"), 200)
    setTimeout(() => writeFileSync(join(dir, "retry.url"), good()), 2_500)
    expect((await collectLinkManually({ label: "retry", recipient: "x@resend.dev", type: "invite", timeoutMs: 15_000 })).token).toBe(T)
  })

  it("refuses a link that fails the ownership check, without opening it, and waits for the right one", async () => {
    const other = "f".repeat(56)
    const seen: string[] = []
    setTimeout(() => writeFileSync(join(dir, "owner.url"), good().replace(T, other)), 200)
    setTimeout(() => writeFileSync(join(dir, "owner.url"), good()), 2_500)
    const link = await collectLinkManually({
      label: "owner",
      recipient: "x@resend.dev",
      type: "invite",
      timeoutMs: 15_000,
      verify: async (l) => {
        seen.push(l.token)
        if (l.token !== T) throw new Error("Refusing to open the invite link: the token does NOT belong to this run's disposable account.")
      },
    })
    expect(link.token).toBe(T)
    expect(seen).toEqual([other, T])
  })

  it("times out cleanly when no valid link arrives", async () => {
    setTimeout(() => writeFileSync(join(dir, "late.url"), good().replace("localhost:3100", "evil.example")), 200)
    await expect(collectLinkManually({ label: "late", recipient: "x@resend.dev", type: "invite", timeoutMs: 3_000 })).rejects.toThrow(/No valid invitation link/)
    expect(existsSync(dir)).toBe(false)
  })
})

describe("links inside copied text", () => {
  it("finds the LinkOps confirm link inside copied HTML", () => {
    const html = `<p><a href="${good().replace(/&/g, "&amp;")}">Accept invitation</a></p>`
    expect(parseEmailLink(html, "invite").token).toBe(T)
  })
  it("describes refused input without revealing it", () => {
    let message = ""
    try {
      parseEmailLink("pbpaste > '/var/folders/x/T/linkops-e2e-links-abc/link-invite.url'", "invite")
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/not a URL \(\d+ characters, is not a link\)/)
    expect(message).not.toContain("/var/folders")
  })
})

describe("scripts/e2e-save-link.sh (stand-in clipboard: the real one is not touched)", () => {
  function runScript(clipboard: string) {
    const fakeTmp = mkdtempSync(join(tmpdir(), "save-link-test-"))
    const bin = join(fakeTmp, "bin")
    mkdirSync(bin)
    writeFileSync(join(bin, "pbpaste"), `#!/bin/bash\nprintf '%s' "$FAKE_CLIPBOARD"\n`, { mode: 0o755 })
    writeFileSync(join(bin, "pbcopy"), `#!/bin/bash\ncat > "$FAKE_TMP/cleared"\n`, { mode: 0o755 })
    const waitDir = join(fakeTmp, "linkops-e2e-links-run1")
    mkdirSync(waitDir, { mode: 0o700 })
    writeFileSync(join(waitDir, "WAITING"), "link-invite\n")
    const r = spawnSync("bash", ["scripts/e2e-save-link.sh"], { env: { NODE_ENV: "test", PATH: `${bin}:/usr/bin:/bin`, TMPDIR: `${fakeTmp}/`, FAKE_CLIPBOARD: clipboard, FAKE_TMP: fakeTmp }, encoding: "utf8" })
    const saved = join(waitDir, "link-invite.url")
    const out = { status: r.status, output: r.stdout + r.stderr, saved: existsSync(saved) ? readFileSync(saved, "utf8") : null, mode: existsSync(saved) ? statSync(saved).mode & 0o777 : 0, cleared: existsSync(join(fakeTmp, "cleared")) }
    rmSync(fakeTmp, { recursive: true, force: true })
    return out
  }

  it("saves a valid link privately, clears the clipboard and never prints the token", () => {
    const r = runScript(good())
    expect(r.status).toBe(0)
    expect(r.saved?.trim()).toBe(good())
    expect(r.mode).toBe(0o600)
    expect(r.cleared).toBe(true)
    expect(r.output).not.toContain(T)
  })
  it("refuses anything that is not a http://localhost:3100/auth/confirm link, and saves nothing", () => {
    for (const bad of ["pbpaste > '/tmp/x'", "Accept invitation", good().replace("localhost:3100", "evil.example"), ""]) {
      const r = runScript(bad)
      expect(r.status).toBe(1)
      expect(r.saved).toBeNull()
      expect(r.output).not.toContain(T)
    }
  })
})
