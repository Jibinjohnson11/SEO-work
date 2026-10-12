import { NextResponse, type NextRequest } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { safeRedirectPath } from "@/lib/url"

// Landing route for Supabase email links (invite, password recovery, magic link).
// Configure the email templates to link to: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const code = searchParams.get("code")
  const defaultNext = type === "invite" || type === "recovery" ? "/auth/set-password" : "/"
  const next = safeRedirectPath(searchParams.get("next"), defaultNext)
  const supabase = await createClient()

  let ok = false
  if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error
  else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error

  return NextResponse.redirect(new URL(ok ? next : "/login?error=link", request.url))
}
