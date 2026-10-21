import "server-only"

import { createClient } from "@supabase/supabase-js"

import { clientEnv } from "@/lib/env.client"
import { serverEnv } from "@/lib/env.server"
import type { Database } from "@/lib/supabase/database.types"

/**
 * The secret-key client (AD-6): it acts as `service_role`, with no session,
 * so it can call the commands granted to `service_role` only (today
 * `record_error_event` and `health_check`). It bypasses RLS, so it never
 * reads or writes anything on a member's behalf.
 *
 * This is the only module that reads SUPABASE_SECRET_KEY, and ESLint lets
 * only the AD-6 importers listed in eslint.config.mjs import it.
 */
export function createAdminClient() {
  return createClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SECRET_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}
