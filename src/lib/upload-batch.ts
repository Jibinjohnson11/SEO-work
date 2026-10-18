import type { ActionResult } from "@/lib/actions"

/** Same limits as the server (src/server/workflow.ts); checked in the browser first for clear messages. */
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024
export const MAX_UPLOAD_FILES = 10

/** Problem with a selected batch, or null when it may be uploaded. Nothing is sent if this fails. */
export function uploadBatchProblem(files: { name: string; size: number }[]): string | null {
  if (!files.length) return "Choose at least one file"
  if (files.length > MAX_UPLOAD_FILES) return `Upload at most ${MAX_UPLOAD_FILES} files at a time`
  const tooBig = files.filter((f) => f.size > MAX_UPLOAD_FILE_BYTES)
  if (tooBig.length) return `${tooBig.map((f) => f.name).join(", ")}: larger than 10 MB`
  return null
}

/**
 * Uploads files one request at a time (a single request carrying several files could exceed the
 * server's request size limit even when each file is under 10 MB). Stops at the first failure;
 * files uploaded before it stay uploaded (each upload is atomic on the server), and the result says
 * how many succeeded so the UI can refresh and report a partial upload honestly.
 */
export async function uploadSequentially<F>(
  files: F[],
  uploadOne: (file: F) => Promise<ActionResult<unknown>>,
): Promise<{ uploaded: number; result: ActionResult<unknown> }> {
  for (let i = 0; i < files.length; i++) {
    let r: ActionResult<unknown>
    try {
      r = await uploadOne(files[i])
    } catch {
      r = { ok: false, error: "Connection problem — the upload did not finish. Check your connection and try again." }
    }
    if (!r.ok)
      return { uploaded: i, result: { ok: false, error: i ? `${i} of ${files.length} files uploaded, then: ${r.error}` : r.error } }
  }
  return { uploaded: files.length, result: { ok: true, message: files.length > 1 ? `${files.length} files uploaded` : "File uploaded" } }
}
