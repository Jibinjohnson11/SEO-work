import { describe, expect, it } from "vitest"
import { MAX_UPLOAD_FILE_BYTES, uploadBatchProblem, uploadSequentially } from "@/lib/upload-batch"

// Uploads go one file per request, stop at the first failure and report partial success honestly.

const file = (name: string, size = 1024) => ({ name, size })

describe("batch checks before anything is sent", () => {
  it("accepts up to 10 files of up to 10 MB each", () => {
    expect(uploadBatchProblem([file("a.pdf", MAX_UPLOAD_FILE_BYTES), ...Array.from({ length: 9 }, (_, i) => file(`f${i}.pdf`))])).toBeNull()
  })
  it("rejects an empty selection, more than 10 files, and any file over 10 MB (naming it)", () => {
    expect(uploadBatchProblem([])).toMatch(/at least one/)
    expect(uploadBatchProblem(Array.from({ length: 11 }, (_, i) => file(`f${i}.pdf`)))).toMatch(/at most 10/)
    expect(uploadBatchProblem([file("ok.pdf"), file("huge.pdf", MAX_UPLOAD_FILE_BYTES + 1)])).toBe("huge.pdf: larger than 10 MB")
  })
})

describe("sequential upload", () => {
  it("sends exactly one file per request, in order, never two at once", async () => {
    const seen: string[] = []
    let inFlight = 0, maxInFlight = 0
    const r = await uploadSequentially([file("1"), file("2"), file("3")], async (f) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); seen.push(f.name)
      await new Promise((res) => setTimeout(res, 5))
      inFlight--
      return { ok: true }
    })
    expect(seen).toEqual(["1", "2", "3"])
    expect(maxInFlight).toBe(1)
    expect(r).toEqual({ uploaded: 3, result: { ok: true, message: "3 files uploaded" } })
  })

  it("stops at the first failure and reports how many files were uploaded before it", async () => {
    const seen: string[] = []
    const r = await uploadSequentially([file("1"), file("2"), file("3")], async (f) => {
      seen.push(f.name)
      return f.name === "2" ? { ok: false, error: "2: file type not allowed" } : { ok: true }
    })
    expect(seen).toEqual(["1", "2"]) // file 3 is never sent
    expect(r.uploaded).toBe(1)
    expect(r.result).toEqual({ ok: false, error: "1 of 3 files uploaded, then: 2: file type not allowed" })
  })

  it("a failure on the first file reports only the server's message", async () => {
    const r = await uploadSequentially([file("1")], async () => ({ ok: false, error: "Not allowed" }))
    expect(r).toEqual({ uploaded: 0, result: { ok: false, error: "Not allowed" } })
  })

  it("a network failure mid-batch is reported as a connection problem, keeping the partial count", async () => {
    const r = await uploadSequentially([file("1"), file("2")], async (f) => {
      if (f.name === "2") throw new TypeError("Failed to fetch")
      return { ok: true }
    })
    expect(r.uploaded).toBe(1)
    expect(r.result).toMatchObject({ ok: false, error: expect.stringMatching(/^1 of 2 files uploaded, then: Connection problem/) })
  })

  it("a single successful file says 'File uploaded'", async () => {
    expect((await uploadSequentially([file("1")], async () => ({ ok: true }))).result).toEqual({ ok: true, message: "File uploaded" })
  })
})
