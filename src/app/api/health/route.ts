import { NextResponse } from "next/server"
import { isSupabaseConfigured, publicEnv } from "@/lib/env"

export const dynamic = "force-dynamic"

/**
 * Public health check for uptime monitors: 200 when the app is configured and Supabase Auth
 * answers, 503 otherwise. It reveals nothing beyond up/down.
 */
export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } })
  let ok = false
  try {
    const res = await fetch(`${publicEnv.supabaseUrl.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: publicEnv.supabaseAnonKey },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    })
    ok = res.ok
  } catch {
    ok = false
  }
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } })
}
