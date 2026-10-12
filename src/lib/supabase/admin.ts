import "server-only"
import { createClient } from "@supabase/supabase-js"
import { publicEnv } from "@/lib/env"
import { MissingConfigError, serverEnv } from "@/lib/server-env"

/**
 * Service-role client. Bypasses RLS, so it is only used for operations that cannot run as
 * the user (inviting auth users, scheduled jobs) and always after an explicit permission check.
 */
export function createAdminClient() {
  if (!publicEnv.supabaseUrl || !serverEnv.serviceRoleKey) {
    throw new MissingConfigError(
      [!publicEnv.supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL", !serverEnv.serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(
        Boolean,
      ) as string[],
      "This administrative operation",
    )
  }
  return createClient(publicEnv.supabaseUrl, serverEnv.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
