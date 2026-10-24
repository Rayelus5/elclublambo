import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverSupabaseUrl } from "@/lib/supabase/urls";

/** Service-role client. Server only; bypasses RLS. Never import from client code. */
export function createAdminClient() {
  return createClient(serverSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
