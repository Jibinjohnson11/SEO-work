import { describe, expect, it } from "vitest"
import { classify, extractLinks, attributeFromRel } from "@/lib/verification/links"
import { assertFetchableUrl, isPublicAddress, safeFetch } from "@/lib/verification/net"

const page = (body: string) => `<html><head></head><body><a href="/a">A</a><a href="/b">B</a><a href="https://other.com">C</a>${body}</body></html>`

describe("link extraction", () => {
  it("resolves relative links, base href, anchor text and rel", () => {
    const links = extractLinks(
      `<base href="https://pub.example.com/blog/"><a href="post"> Read   more </a><a rel="NoFollow ugc" href="https://t.example.com/x"><img alt="Logo"></a><a href="javascript:void(0)">x</a>`,
      "https://pub.example.com/",
    )
    expect(links).toEqual([
      { href: "https://pub.example.com/blog/post", text: "Read more", rel: [] },
      { href: "https://t.example.com/x", text: "Logo", rel: ["nofollow", "ugc"] },
    ])
    expect(attributeFromRel(["nofollow", "ugc"])).toBe("ugc")
    expect(attributeFromRel(["sponsored", "nofollow"])).toBe("sponsored")
  })
})

describe("classification", () => {
  const common = { pageUrl: "https://pub.example.com/post", targetUrl: "https://dentalcare.example.com/implants", contentType: "text/html" }
  it("live when the target link is present with the expected anchor and attribute", () => {
    const r = classify({ ...common, httpStatus: 200, html: page(`<a href="https://www.dentalcare.example.com/implants/">dental implants</a>`), expectedAnchor: "Dental Implants", expectedAttribute: "dofollow" })
    expect(r).toMatchObject({ result: "live", link_found: true, detected_attribute: "dofollow", found_anchor_text: "dental implants" })
  })
  it("HTTP 200 without the link is not proof of a backlink", () => {
    expect(classify({ ...common, httpStatus: 200, html: page("") }).result).toBe("missing")
  })
  it("changed when anchor or rel differ", () => {
    const r = classify({ ...common, httpStatus: 200, html: page(`<a rel="nofollow" href="https://dentalcare.example.com/implants">click here</a>`), expectedAnchor: "dental implants", expectedAttribute: "dofollow" })
    expect(r.result).toBe("changed")
    expect(r.error).toMatch(/anchor text.*nofollow/)
  })
  it("maps HTTP and access problems", () => {
    expect(classify({ ...common, httpStatus: 404 }).result).toBe("missing")
    expect(classify({ ...common, httpStatus: 503 }).result).toBe("unreachable")
    expect(classify({ ...common, httpStatus: 403 }).result).toBe("inconclusive")
    expect(classify({ ...common, httpStatus: null, networkError: "ECONNRESET" }).result).toBe("unreachable")
    expect(classify({ ...common, httpStatus: null, robotsAllowed: false }).result).toBe("inconclusive")
    expect(classify({ ...common, httpStatus: 200, contentType: "application/pdf" }).result).toBe("inconclusive")
  })
  it("treats script-rendered pages as inconclusive rather than missing", () => {
    expect(classify({ ...common, httpStatus: 200, html: `<div id="root"></div>` }).result).toBe("inconclusive")
  })
})

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])(
    "blocks %s",
    (ip) => expect(isPublicAddress(ip)).toBe(false),
  )
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true))

  it.each([
    "file:///etc/passwd",
    "http://localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://user:pw@example.com/",
    "http://example.com:8080/",
    "http://metadata.google.internal/",
  ])("rejects %s", (url) => expect(() => assertFetchableUrl(url)).toThrow())

  it("re-checks resolved addresses at connect time (DNS rebinding)", async () => {
    await expect(
      safeFetch("http://rebind.example.com/", { resolver: async () => [{ address: "127.0.0.1", family: 4 }], timeoutMs: 2000 }),
    ).rejects.toThrow(/private or reserved/)
  })
})
