import { describe, expect, it } from "vitest"
import { richTextToPlain, richTextToText, sanitizeRichText } from "@/lib/rich-text"

describe("sanitizeRichText", () => {
  it("keeps headings, paragraphs, lists and safe links", () => {
    expect(sanitizeRichText('<h2>Title</h2><p>Hi <strong>there</strong></p><ul><li>One</li></ul><a href="https://x.test">x</a>')).toBe(
      '<h2>Title</h2><p>Hi <strong>there</strong></p><ul><li>One</li></ul><a href="https://x.test" target="_blank" rel="noopener noreferrer nofollow">x</a>',
    )
  })

  it("drops scripts, event handlers, styles and unsafe links", () => {
    expect(sanitizeRichText('<p onclick="x()" style="color:red">ok</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><img src=x onerror=alert(1)>')).toBe("<p>ok</p>bad")
  })

  it("unwraps unknown tags and escapes text", () => {
    expect(sanitizeRichText("<span>a &lt;b&gt;</span><div>c</div><h1>d</h1>")).toBe("a &lt;b&gt;<p>c</p><h2>d</h2>")
  })
})

describe("richTextToPlain", () => {
  it("treats markup-only content as empty", () => {
    expect(richTextToPlain("<p><br></p><p>&nbsp;</p>")).toBe("")
  })
})

describe("richTextToText", () => {
  it("keeps paragraph and line breaks and decodes entities", () => {
    expect(richTextToText("<h2>Title</h2><p>One &amp; two</p><ul><li>A</li><li>B</li></ul><p>Line<br>break</p>")).toBe("Title\n\nOne & two\n\nA\n\nB\n\nLine\nbreak")
  })
})
