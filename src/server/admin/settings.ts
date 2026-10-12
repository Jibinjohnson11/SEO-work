"use server"

import { revalidatePath } from "next/cache"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { SETTINGS_SCHEMAS, type SettingsKey } from "@/lib/validation"

export async function saveSettings(key: SettingsKey, value: unknown) {
  return run(async () => {
    const schema = SETTINGS_SCHEMAS[key]
    if (!schema) throw new Error("Unknown settings section")
    const parsed = schema.parse(value)
    const { supabase, userId } = await authorize(["super_admin"])
    must(
      await supabase
        .from("application_settings")
        .upsert({ key, value: parsed, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" }),
    )
    revalidatePath("/", "layout")
  }, "Settings saved")
}
