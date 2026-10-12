import "server-only"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { publicEnv } from "@/lib/env"

/** Request-scoped client acting as the signed-in user. Row Level Security applies. */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
        } catch {
          // Called from a Server Component; the proxy refreshes the session cookie instead.
        }
      },
    },
  })
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>
