import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { LOGO_BUCKET } from "@/lib/brand-logo"

/** Signed display URLs (1 hour) for brand logos, keyed by storage path. Missing or failed paths are left out. */
export async function brandLogoUrls(supabase: SupabaseClient, paths: (string | null | undefined)[]) {
  const unique = [...new Set(paths.filter((p): p is string => !!p))]
  const urls = new Map<string, string>()
  if (!unique.length) return urls
  const { data } = await supabase.storage.from(LOGO_BUCKET).createSignedUrls(unique, 3600)
  for (const s of data ?? []) if (s.path && s.signedUrl && !s.error) urls.set(s.path, s.signedUrl)
  return urls
}
