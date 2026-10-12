"use server"

import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"

const schema = z.object({
  page: z.string().min(1).max(120).regex(/^\/[\w/-]*$/),
  name: z.string().trim().min(1, "Name is required").max(60),
  query: z.string().max(2000),
})

export async function saveFilterPreset(input: z.infer<typeof schema>) {
  return run(async () => {
    const data = schema.parse(input)
    const { supabase, userId } = await authorize(["super_admin", "intern", "client"])
    must(
      await supabase
        .from("saved_filters")
        .upsert({ user_id: userId, ...data }, { onConflict: "user_id,page,name" }),
    )
  }, "Filter preset saved")
}

export async function deleteFilterPreset(id: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin", "intern", "client"])
    must(await supabase.from("saved_filters").delete().eq("id", z.string().uuid().parse(id)))
  }, "Preset removed")
}
