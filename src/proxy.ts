import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { isSupabaseConfigured, publicEnv } from "@/lib/env"

const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/setup", "/forgot-password", "/api/cron"]

// Refreshes the Supabase session cookie and sends signed-out visitors to /login.
// Role checks happen on the server for every page and action, not here.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!isSupabaseConfigured()) {
    if (isPublic) return NextResponse.next()
    return NextResponse.redirect(new URL("/setup", request.url))
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
        if (headers) for (const [k, v] of Object.entries(headers)) response.headers.set(k, v as string)
      },
    },
  })

  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)

  if (!signedIn && !isPublic) {
    const url = new URL("/login", request.url)
    if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  }
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
