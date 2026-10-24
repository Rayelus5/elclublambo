import "server-only";
import { createServerClient as createClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { authCookieName, serverSupabaseUrl } from "@/lib/supabase/urls";

export async function createServerClient() {
  // supabase-js reads Date.now() (token expiry). With cacheComponents that must not run while
  // prerendering, so mark everything that uses this client as request-time first.
  await connection();
  const cookieStore = await cookies();
  return createClient(serverSupabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: authCookieName(process.env.NEXT_PUBLIC_SUPABASE_URL!) },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}
