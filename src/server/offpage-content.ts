"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ActionError, authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { richTextToPlain, sanitizeRichText } from "@/lib/rich-text"
import { clientDecisionSchema, offpageContentSchema, type OffpageContentInput } from "@/lib/validation"

const id = z.string().uuid()

function revalidateContent() {
  revalidatePath("/admin/page-content")
  revalidatePath("/intern/content")
  revalidatePath("/portal/approvals")
}

/**
 * Creates content (contentId null) or resubmits it as a new version; either way it goes straight to the
 * client for approval. The database checks the author, campaign assignment, keyword and backlink type.
 */
export async function submitOffpageContent(contentId: string | null, input: OffpageContentInput) {
  return run(async () => {
    const v = offpageContentSchema.parse(input)
    const content_html = sanitizeRichText(v.content_html)
    if (!richTextToPlain(content_html)) throw new ActionError("Write or paste the content")
    const { supabase } = await authorize(["super_admin", "intern"], { intern: "intern.content" })
    must(await supabase.rpc("offpage_content_submit", { p_id: contentId ? id.parse(contentId) : null, p_data: { ...v, content_html } }))
    revalidateContent()
  }, contentId ? "New version sent for client approval" : "Content submitted for client approval")
}

export async function contentClientDecision(contentId: string, input: z.infer<typeof clientDecisionSchema>) {
  return run(async () => {
    const data = clientDecisionSchema.parse(input)
    const { supabase } = await authorize(["client"], "portal.approvals.decide")
    must(
      await supabase.rpc("offpage_content_client_decision", {
        p_id: id.parse(contentId),
        p_decision: data.decision,
        p_feedback: data.feedback,
        p_version: data.version,
      }),
    )
    revalidateContent()
    revalidatePath(`/portal/approvals/content/${contentId}`)
  }, "Thank you — your decision was recorded")
}

/** Super Admin decision on the client's behalf: needs a reason and Approval Settings → allow admin override. */
export async function contentAdminDecision(contentId: string, input: z.infer<typeof clientDecisionSchema>) {
  return run(async () => {
    const data = clientDecisionSchema.parse(input)
    if (!data.feedback?.trim()) throw new ActionError("An override reason is required")
    const { supabase } = await authorize(["super_admin"])
    must(
      await supabase.rpc("offpage_content_admin_decision", {
        p_id: id.parse(contentId),
        p_decision: data.decision,
        p_reason: data.feedback,
        p_version: data.version,
      }),
    )
    revalidateContent()
    revalidatePath("/admin/approvals", "layout")
  }, "Override recorded")
}
