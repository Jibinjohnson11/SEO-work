"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import {
  clientDecisionSchema,
  internalReviewSchema,
  manualVerificationSchema,
  publicationSchema,
  submissionSchema,
  type InternalReviewInput,
  type SubmissionInput,
} from "@/lib/validation"
import { runVerificationBatch } from "@/lib/verification/run"
import { getSetting } from "@/server/queries"

const id = z.string().uuid()

function revalidateSubmission(submissionId?: string) {
  revalidatePath("/admin", "layout")
  revalidatePath("/intern", "layout")
  revalidatePath("/portal", "layout")
  if (submissionId) revalidatePath(`/admin/submissions/${submissionId}`)
}

// ---------------------------------------------------------------------------
// Intern
// ---------------------------------------------------------------------------
export async function saveSubmission(submissionId: string | null, input: SubmissionInput, submit: boolean) {
  return run(async () => {
    const data = submissionSchema.parse(input)
    const { supabase } = await authorize(["intern"])
    const newId = must(
      await supabase.rpc("submission_save", {
        p_id: submissionId ? id.parse(submissionId) : null,
        p_data: { ...data, domain_rating: String(data.domain_rating), domain_authority: String(data.domain_authority), estimated_traffic: String(data.estimated_traffic) },
        p_submit: submit,
      }),
    ) as string
    revalidateSubmission(newId)
    return newId
  }, submit ? "Submitted for review" : "Draft saved")
}

export async function setMyTaskStatus(taskId: string, status: "in_progress" | "submitted") {
  return run(async () => {
    const { supabase } = await authorize(["intern"])
    must(await supabase.rpc("task_set_status", { p_task_id: id.parse(taskId), p_status: status }))
    revalidatePath("/intern/tasks")
  }, "Task updated")
}

const ALLOWED_FILE_TYPES: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
}
const MAX_FILE_BYTES = 10 * 1024 * 1024

export async function uploadSubmissionFiles(formData: FormData) {
  return run(async () => {
    const submissionId = id.parse(formData.get("submission_id"))
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) throw new Error("Choose at least one file")
    if (files.length > 10) throw new Error("Upload at most 10 files at a time")
    const { supabase } = await authorize(["intern", "super_admin"])
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!ALLOWED_FILE_TYPES[file.type]?.includes(ext)) throw new Error(`${file.name}: file type not allowed`)
      if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: larger than 10 MB`)
    }
    for (const file of files) {
      const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80)
      const path = `${submissionId}/${randomUUID()}-${safeName}`
      const up = await supabase.storage.from("submission-files").upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) throw new Error(`${file.name}: ${up.error.message}`)
      const rec = await supabase.rpc("submission_add_file", {
        p_submission_id: submissionId,
        p_storage_path: path,
        p_file_name: file.name.slice(0, 200),
        p_mime_type: file.type,
        p_size_bytes: file.size,
      })
      if (rec.error) {
        await supabase.storage.from("submission-files").remove([path])
        throw rec.error
      }
    }
    revalidateSubmission(submissionId)
    return files.length
  }, "Files uploaded")
}

export async function removeSubmissionFile(fileId: string) {
  return run(async () => {
    const { supabase } = await authorize(["intern", "super_admin"])
    const path = must(await supabase.rpc("submission_remove_file", { p_file_id: id.parse(fileId) })) as string
    await supabase.storage.from("submission-files").remove([path])
    revalidateSubmission()
  }, "File removed")
}

/** Short-lived download link; storage RLS decides whether the user may read the file. */
export async function getFileUrl(fileId: string) {
  return run(async () => {
    const { supabase } = await authorize(["intern", "super_admin"])
    const f = must(await supabase.from("submission_files").select("storage_path, file_name").eq("id", id.parse(fileId)).single())
    const signed = await supabase.storage.from("submission-files").createSignedUrl(f.storage_path, 120, { download: f.file_name })
    if (signed.error) throw signed.error
    return signed.data.signedUrl
  })
}

// ---------------------------------------------------------------------------
// Super Admin review & workflow control
// ---------------------------------------------------------------------------
export async function startReview(submissionId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.rpc("submission_start_review", { p_id: id.parse(submissionId) }))
    revalidateSubmission(submissionId)
  }, "Marked as in review")
}

export async function internalDecision(submissionId: string, input: InternalReviewInput) {
  return run(async () => {
    const data = internalReviewSchema.parse(input)
    const { supabase } = await authorize(["super_admin"])
    must(
      await supabase.rpc("submission_internal_decision", {
        p_id: id.parse(submissionId),
        p_decision: data.decision,
        p_comments: data.comments,
        p_checklist: data.checklist,
        p_medical: data.medical,
        p_forward: data.forward_to_client,
      }),
    )
    revalidateSubmission(submissionId)
  }, "Review recorded")
}

export async function sendToClient(submissionId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.rpc("submission_send_to_client", { p_id: id.parse(submissionId) }))
    revalidateSubmission(submissionId)
  }, "Sent for client approval")
}

export async function markReady(submissionId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.rpc("submission_mark_ready", { p_id: id.parse(submissionId) }))
    revalidateSubmission(submissionId)
  }, "Marked ready for publication")
}

export async function adminOverride(submissionId: string, reason: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.rpc("submission_admin_override", { p_id: id.parse(submissionId), p_reason: reason }))
    revalidateSubmission(submissionId)
  }, "Override recorded")
}

export async function reassignSubmission(submissionId: string, internId: string, note: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.rpc("submission_reassign", { p_id: id.parse(submissionId), p_intern_id: id.parse(internId), p_note: note }))
    revalidateSubmission(submissionId)
  }, "Submission reassigned")
}

export async function archiveSubmission(submissionId: string, reason: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.rpc("submission_archive", { p_id: id.parse(submissionId), p_reason: reason }))
    revalidateSubmission(submissionId)
  }, "Submission archived")
}

const adminEditSchema = submissionSchema
  .pick({ proposed_website: true, placement_url: true, target_url: true, anchor_text: true, content_title: true, content_draft: true, notes: true, link_attribute: true })
  .extend({ change_summary: z.string().trim().max(500) })

export async function adminEditSubmission(submissionId: string, input: z.infer<typeof adminEditSchema>) {
  return run(async () => {
    const { change_summary, ...data } = adminEditSchema.parse(input)
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.rpc("submission_admin_edit", { p_id: id.parse(submissionId), p_data: data, p_summary: change_summary }))
    revalidateSubmission(submissionId)
  }, "Submission updated")
}

// ---------------------------------------------------------------------------
// Client decisions
// ---------------------------------------------------------------------------
export async function clientDecision(submissionId: string, input: z.infer<typeof clientDecisionSchema>) {
  return run(async () => {
    const data = clientDecisionSchema.parse(input)
    const { supabase } = await authorize(["client"])
    must(
      await supabase.rpc("submission_client_decision", {
        p_id: id.parse(submissionId),
        p_decision: data.decision,
        p_feedback: data.feedback,
        p_version: data.version,
      }),
    )
    revalidateSubmission(submissionId)
  }, "Thank you — your decision was recorded")
}

// ---------------------------------------------------------------------------
// Publication & verification
// ---------------------------------------------------------------------------
export async function recordPublication(submissionId: string, input: z.infer<typeof publicationSchema>) {
  return run(async () => {
    const data = publicationSchema.parse(input)
    const { supabase } = await authorize(["intern", "super_admin"])
    const publishedId = must(
      await supabase.rpc("submission_record_publication", {
        p_id: id.parse(submissionId),
        p_published_url: data.published_url,
        p_publication_date: data.publication_date,
        p_link_attribute: data.link_attribute,
        p_anchor_text: data.anchor_text,
      }),
    ) as string
    revalidateSubmission(submissionId)
    return publishedId
  }, "Publication recorded — verification pending")
}

export async function verifyNow(publishedIds: string[]) {
  return run(async () => {
    const ids = z.array(id).min(1).max(50).parse(publishedIds)
    const { supabase } = await authorize(["super_admin"])
    const settings = await getSetting("verification")
    const out = await runVerificationBatch(supabase, { ...settings, max_per_run: ids.length }, { ids, budgetMs: 55_000 })
    revalidateSubmission()
    return out
  })
}

export async function manualVerify(publishedId: string, input: z.infer<typeof manualVerificationSchema>) {
  return run(async () => {
    const data = manualVerificationSchema.parse(input)
    const { supabase } = await authorize(["super_admin"])
    must(
      await supabase.rpc("record_verification", {
        p_published_id: id.parse(publishedId),
        p_check: { result: data.result, method: "manual", notes: data.notes, link_found: data.result === "live" || data.result === "changed" },
      }),
    )
    revalidateSubmission()
  }, "Manual verification recorded")
}
