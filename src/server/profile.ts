"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"

const schema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(40),
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true } catch { return false } }, "Unknown time zone"),
  email_notifications: z.boolean(),
})

/** Self-service fields only; role, status and targets are protected by the database. */
export async function updateMyProfile(input: z.infer<typeof schema>) {
  return run(async () => {
    const data = schema.parse(input)
    const { supabase, userId } = await authorize(["super_admin", "intern", "client"])
    must(await supabase.from("profiles").update({ ...data, phone: data.phone || null }).eq("id", userId))
    revalidatePath("/", "layout")
  }, "Profile saved")
}
