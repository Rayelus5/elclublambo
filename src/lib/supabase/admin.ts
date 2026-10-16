import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service-role client. Server only; bypasses RLS. Never import from client code. */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
