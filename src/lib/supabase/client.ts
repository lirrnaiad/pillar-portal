import { createBrowserClient } from "@supabase/ssr"

import { clientEnv } from "@/lib/env.client"
import type { Database } from "@/lib/supabase/database.types"

/**
 * A Supabase client for Client Components, acting as the signed-in user
 * through the session cookies. It holds the publishable key only; RLS decides
 * what it can read, and it can write nothing directly (AD-1).
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
}
