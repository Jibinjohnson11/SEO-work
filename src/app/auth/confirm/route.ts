import { NextResponse, type NextRequest } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { safeRedirectPath } from "@/lib/url"

// Landing route for Supabase email links (sign-up confirmation, invite, password recovery).
// The email templates link to: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>
//
// Opening a token_hash link does NOT use the one-time token: GET only forwards to a
// "Continue" page, and the token is verified when that page's form is POSTed back here.
// Corporate mail scanners (e.g. Outlook Safe Links) open every link in a message, which
// previously used up invitations and reset links before the person could click them.

const OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "recovery", "email", "magiclink", "email_change"])

function defaultNext(type: string | null) {
  return type === "invite" || type === "recovery" ? "/auth/set-password" : "/"
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type")
  const code = searchParams.get("code")

  if (tokenHash && type) {
    const url = new URL("/auth/continue", request.url)
    url.search = new URLSearchParams({ token_hash: tokenHash, type, next: safeRedirectPath(searchParams.get("next"), defaultNext(type)) }).toString()
    return NextResponse.redirect(url)
  }

  // PKCE code links can only be exchanged by the browser holding the code verifier cookie,
  // so a scanner cannot use them up.
  if (code) {
    const supabase = await createClient()
    const ok = !(await supabase.auth.exchangeCodeForSession(code)).error
    const next = safeRedirectPath(searchParams.get("next"), "/")
    return NextResponse.redirect(new URL(ok ? next : "/login?error=link", request.url))
  }
  return NextResponse.redirect(new URL("/login?error=link", request.url))
}

export async function POST(request: NextRequest) {
  // The form is only ever posted from our own /auth/continue page.
  const origin = request.headers.get("origin")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (origin && origin !== "null" && host && URL.canParse(origin) && new URL(origin).host !== host)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const form = await request.formData()
  const tokenHash = String(form.get("token_hash") ?? "")
  const type = String(form.get("type") ?? "") as EmailOtpType
  const next = safeRedirectPath(String(form.get("next") ?? ""), defaultNext(type))

  let ok = false
  if (tokenHash && OTP_TYPES.has(type)) {
    const supabase = await createClient()
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error
  }
  // 303 so the browser follows with GET.
  return NextResponse.redirect(new URL(ok ? next : "/login?error=link", request.url), 303)
}
