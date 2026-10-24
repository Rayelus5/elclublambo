import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/public-paths";
import { applySessionHeaders } from "@/lib/auth/session-headers";
import { isMissingChannel, NOT_FOUND_PATH } from "@/lib/channels/guard";
import { isHiddenReportsPage } from "@/lib/reports/guard";
import { isHiddenSettingsPage } from "@/lib/permissions/settings-guard";
import { WELCOMED_COOKIE, welcomeStatus } from "@/lib/onboarding/guard";
import { isMissingTicket } from "@/lib/tickets/guard";
import { isInvalidCoinPage } from "@/lib/market/guard";
import { isHiddenTreasuryPage } from "@/lib/treasury/guard";
import { isHttps } from "@/lib/security/headers";
import { authCookieName, serverSupabaseUrl } from "@/lib/supabase/urls";

export async function proxy(request: NextRequest) {
  // Layouts do not receive the pathname: the forum layout reads it from this header (onboarding redirect keeps `next`).
  // Set on the request itself (overwrites anything the client sent) so the cookie refresh below still forwards with it.
  request.headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request });
  let sessionCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];
  let sessionHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: authCookieName(process.env.NEXT_PUBLIC_SUPABASE_URL!) },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          sessionCookies = cookiesToSet;
          sessionHeaders = { ...sessionHeaders, ...headers };
          response = applySessionHeaders(NextResponse.next({ request }), sessionCookies, sessionHeaders);
        },
      },
    },
  );

  // getUser() validates the JWT with the auth server (getSession() does not).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // T-006: the welcome memo (WELCOMED_COOKIE). Set after a read that saw the welcome completed; cleared once the session
  // is gone (signed out), whatever page the request was for. Secure follows the public site URL, like HSTS (F5-R4):
  // behind the Cloudflare Tunnel the request reaches Next over plain http.
  let welcomedNow = false;
  const staleMemo = !user && request.cookies.has(WELCOMED_COOKIE);
  const remember = <R extends NextResponse>(res: R): R => {
    if (welcomedNow && user) {
      res.cookies.set(WELCOMED_COOKIE, user.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: isHttps(process.env.NEXT_PUBLIC_SITE_URL),
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    } else if (staleMemo) {
      res.cookies.delete(WELCOMED_COOKIE);
    }
    return res;
  };

  const { pathname } = request.nextUrl;
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return remember(applySessionHeaders(NextResponse.redirect(url), sessionCookies, sessionHeaders));
  }

  // First login: the welcome (mandatory @handle) comes first. Enforced here because layouts do not re-run on client
  // navigations. /bienvenida, /guia and the (gate) pages are exempt.
  // A completed welcome is never undone: once read, a cookie bound to this user skips the read (T-006).
  if (user && request.cookies.get(WELCOMED_COOKIE)?.value !== user.id) {
    const welcome = await welcomeStatus(supabase, user.id, pathname, request.method);
    if (welcome === "pending") {
      const url = request.nextUrl.clone();
      url.pathname = "/bienvenida";
      url.search = "";
      url.searchParams.set("next", pathname + request.nextUrl.search);
      return applySessionHeaders(NextResponse.redirect(url), sessionCookies, sessionHeaders);
    }
    welcomedNow = welcome === "completed";
  }

  // The page streams under <Suspense>, so a notFound() there would answer 200: decide the 404 here instead.
  // Same for /tickets/<id>: a ticket that is not the member's (nor supported by them) looks exactly like a missing one.
  // The report queue does not exist either for a member who moderates no channel, nor a settings page they cannot open.
  // /mercado/<id> with an id the page would reject (`../`, uppercase…) is a 404 too.
  if (
    user &&
    ((await isMissingChannel(supabase, pathname)) ||
      (await isMissingTicket(supabase, pathname)) ||
      (await isHiddenReportsPage(supabase, pathname)) ||
      (await isHiddenSettingsPage(supabase, pathname)) ||
      (await isHiddenTreasuryPage(supabase, pathname)) ||
      (await isInvalidCoinPage(supabase, pathname)))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = NOT_FOUND_PATH;
    url.search = "";
    return remember(applySessionHeaders(NextResponse.rewrite(url, { status: 404, request: { headers: request.headers } }), sessionCookies, sessionHeaders));
  }

  return remember(response);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|sw\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
