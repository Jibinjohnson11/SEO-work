#!/usr/bin/env node
// Creates (or promotes) the Super Admin. Run once, from a trusted machine:
//   node --env-file=.env.local scripts/bootstrap-admin.mjs owner@agency.com "Full Name"
// The role is written with the service role key to app_metadata and the profile; there is no
// way to obtain Super Admin access from the application UI or public sign-up.
import { createClient } from "@supabase/supabase-js"

const [email, fullName = ""] = process.argv.slice(2)
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
if (!email || !url || !key) {
  console.error("Usage: node --env-file=.env.local scripts/bootstrap-admin.mjs <email> [full name]")
  console.error("Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const normalized = email.trim().toLowerCase()

let userId
const { data: existing } = await admin.from("profiles").select("id").eq("email", normalized).maybeSingle()
if (existing) userId = existing.id
else {
  const redirectTo = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/auth/confirm?next=/auth/set-password`
  const invited = await admin.auth.admin.inviteUserByEmail(normalized, { redirectTo })
  if (invited.error) {
    // Already an auth user without a profile: look them up.
    const list = await admin.auth.admin.listUsers({ perPage: 1000 })
    userId = list.data?.users.find((u) => u.email?.toLowerCase() === normalized)?.id
    if (!userId) throw invited.error
  } else userId = invited.data.user.id
}

const meta = await admin.auth.admin.updateUserById(userId, { app_metadata: { role: "super_admin" } })
if (meta.error) throw meta.error
const { error } = await admin
  .from("profiles")
  .upsert({ id: userId, email: normalized, full_name: fullName, role: "super_admin", status: existing ? "active" : "invited" }, { onConflict: "id" })
if (error) throw error
console.log(`Super Admin ready: ${normalized} (${userId}).${existing ? "" : " An invitation email was sent to set a password."}`)
