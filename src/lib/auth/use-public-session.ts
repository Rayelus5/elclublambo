"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { resolvePublicSession, type PublicSession } from "./public-session-core";

/**
 * The public session as the header shows it, resolved in the browser: Supabase answers directly, so the public layout
 * reads nothing at request time and the public pages stay static (no Vercel function per view). "pending" until the
 * first read, then it follows sign-ins and sign-outs. Display only: every public action re-checks on the server
 * (getPublicSession). The local session is enough here, the RPCs validate the token.
 */
export function usePublicSession(): PublicSession | null | "pending" {
  const [session, setSession] = useState<PublicSession | null | "pending">("pending");
  useEffect(() => {
    const supabase = createBrowserClient();
    let alive = true;
    let latest = 0;
    // The auth user the last read was for: auth-js emits SIGNED_IN again for the same user at start-up and on every
    // return to the tab, which must not cost new reads.
    let shownUserId: string | null | undefined;
    const read = async () => {
      const mine = ++latest;
      let next: PublicSession | null = null;
      try {
        const { data } = await supabase.auth.getSession();
        shownUserId = data.session?.user?.id ?? null;
        next = await resolvePublicSession(data.session?.user ?? null, supabase);
      } catch {
        // Shown as a visitor: the connect button, as with no session.
      }
      if (alive && mine === latest) setSession(next);
    };
    void read();
    const { data } = supabase.auth.onAuthStateChange((event: string, session: { user?: { id?: string } } | null) => {
      // A refreshed token changes nobody; the first event repeats the read above.
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
      if (event === "SIGNED_IN" && shownUserId !== undefined && session?.user?.id === shownUserId) return;
      void read();
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return session;
}
