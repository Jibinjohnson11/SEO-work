"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { blankToNull, keywordDetailsSchema, type KeywordDetailsInput } from "@/lib/validation"

const id = z.string().uuid()

/**
 * Edits a keyword's target URL and search intent. Keywords themselves are added and removed by name on
 * the campaign forms (shared by every campaign of the brand that uses them).
 */
export async function updateKeywordDetails(keywordId: string, campaignId: string, input: KeywordDetailsInput) {
  return run(async () => {
    const data = blankToNull(keywordDetailsSchema.parse(input))
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.from("keywords").update(data).eq("id", id.parse(keywordId)))
    revalidatePath(`/admin/campaigns/${id.parse(campaignId)}`)
  }, "Keyword updated")
}
