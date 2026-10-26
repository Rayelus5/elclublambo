import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/public-paths";
import { decidePublicRoute, isInternalImagePath, isUnknownTopSegment, legacyClubRedirect } from "@/lib/i18n/public-routing";
import { clubPath } from "@/lib/club/paths";
import { isMissingPublicGiveaway } from "@/lib/public-giveaways/exists";
import { isInvalidPayPath, isMissingPayAlias } from "@/lib/pay/exists";
import { applySessionHeaders } from "@/lib/auth/session-headers";
import { isMissingChannel, NOT_FOUND_PATH } from "@/lib/channels/guard";
import { isHiddenReportsPage } from "@/lib/reports/guard";
import { isHiddenSettingsPage } from "@/lib/permissions/settings-guard";
import { WELCOMED_COOKIE, welcomeStatus } from "@/lib/onboarding/guard";
import { isMissingTicket } from "@/lib/tickets/guard";
import { isInvalidCoinPage } from "@/lib/market/guard";
import { isHiddenTreasuryPage } from "@/lib/treasury/guard";
import { isHttps } from "@/lib/security/headers";
import { publicOrigin } from "@/lib/start/site";
import { authCookieName, serverSupabaseUrl } from "@/lib/supabase/urls";
import { getSiteState } from "@/lib/admin/site-state";
import { isMaintenanceActive, retryAfterSeconds } from "@/lib/admin/state";
import { gateDecision } from "@/lib/admin/gate";
import { statusLang } from "@/lib/admin/paths";
import { MAINTENANCE_BANNER_COOKIE, maintenanceAccess } from "@/lib/admin/access";

export async function proxy(request: NextRequest) {
  // R1: the club moved under /foro. Old club URLs (shared invites, bookmarks, delivered push notifications) 308 there with
  // the same path and query, before anything else: no session read, no gate. On the public origin (behind the tunnel
  // request.nextUrl is the bind address).
  const legacy = legacyClubRedirect(request.nextUrl.pathname, request.nextUrl.search);
  if (legacy !== null) return NextResponse.redirect(new URL(legacy, publicOrigin(request)), 308);

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
  // A-R15: the "maintenance on" strip for whoever the gate below lets through during maintenance; cleared once it no
  // longer applies (and on every 503). Cosmetic only.
  let bannerNow = false;
  const staleBanner = request.cookies.has(MAINTENANCE_BANNER_COOKIE);
  const remember = <R extends NextResponse>(res: R): R => {
    if (bannerNow) {
      res.cookies.set(MAINTENANCE_BANNER_COOKIE, "1", {
        sameSite: "lax",
        secure: isHttps(process.env.NEXT_PUBLIC_SITE_URL),
        path: "/",
      });
    } else if (staleBanner) {
      res.cookies.delete(MAINTENANCE_BANNER_COOKIE);
    }
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

  // Redirects go to the public origin: behind the tunnel request.nextUrl is the bind address (0.0.0.0:3000).
  // Rewrites stay on request.nextUrl (internal).
  const redirectUrl = (path: string, search: string | URLSearchParams = "") => {
    const url = new URL(path, publicOrigin(request));
    url.search = search.toString();
    return url;
  };

  const notFound = () => {
    const url = request.nextUrl.clone();
    url.pathname = NOT_FOUND_PATH;
    url.search = "";
    return remember(applySessionHeaders(NextResponse.rewrite(url, { status: 404, request: { headers: request.headers } }), sessionCookies, sessionHeaders));
  };

  // Administración (A-R7-A-R9): maintenance closes the site and a switched-off tool answers 503, before the public
  // routing and the session gates. A direct /es/* URL is not a tool URL: it 308s below to its canonical URL, and that
  // request is gated here. /status/* is only reachable through these rewrites.
  const siteState = await getSiteState();
  const now = Date.now();
  const access = user && isMaintenanceActive(siteState.maintenance, now) ? await maintenanceAccess(supabase, user) : "none";
  const gate = gateDecision({ pathname, method: request.method, rsc: request.headers.get("rsc") === "1", state: siteState, now, access });
  if (gate.kind === "status404") return notFound();
  if (gate.kind !== "pass") {
    const maintenance = gate.kind === "maintenancePage" || gate.kind === "maintenanceJson";
    const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
    if (maintenance) headers["Retry-After"] = String(retryAfterSeconds(siteState.maintenance, now));
    let res: NextResponse;
    if (gate.kind === "maintenancePage" || gate.kind === "unavailablePage") {
      const url = request.nextUrl.clone();
      url.pathname = `/status/${statusLang(pathname, request.headers.get("accept-language"))}/${maintenance ? "maintenance" : "unavailable"}`;
      url.search = "";
      res = NextResponse.rewrite(url, { status: 503, headers, request: { headers: request.headers } });
    } else {
      res = NextResponse.json({ error: maintenance ? "maintenance" : "unavailable" }, { status: 503, headers });
    }
    return remember(applySessionHeaders(res, sessionCookies, sessionHeaders));
  }
  bannerNow = gate.banner;

  // Public part (bilingual tree): "/" is always the landing and "/donar" the public donate page (the club lives under
  // /foro, R1-R3); Spanish public URLs are rewritten to the internal /es tree and direct visits to /es/* go to their
  // canonical URL (308). Decided before the gates: it is served the same with or without a session.
  const route = decidePublicRoute(pathname);
  if (route.kind === "redirect") {
    const url = redirectUrl(route.to, request.nextUrl.search);
    return remember(applySessionHeaders(NextResponse.redirect(url, 308), sessionCookies, sessionHeaders));
  }
  if (route.kind === "rewrite") {
    // An unknown giveaway id: the page streams under <Suspense> (its notFound() would answer 200), so 404 here.
    if ((await isMissingPublicGiveaway(route.to)) || (await isMissingPayAlias(route.to))) return notFound();
    const url = request.nextUrl.clone();
    url.pathname = route.to;
    return remember(applySessionHeaders(NextResponse.rewrite(url, { request: { headers: request.headers } }), sessionCookies, sessionHeaders));
  }

  if (!user && !isPublicPath(pathname) && !isInternalImagePath(pathname)) {
    const url = redirectUrl(clubPath("/login"), new URLSearchParams({ next: pathname }));
    return remember(applySessionHeaders(NextResponse.redirect(url), sessionCookies, sessionHeaders));
  }

  // First login: the welcome (mandatory @handle) comes first. Enforced here because layouts do not re-run on client
  // navigations. /foro/bienvenida, /foro/guia and the (gate) pages are exempt.
  // A completed welcome is never undone: once read, a cookie bound to this user skips the read (T-006).
  if (user && request.cookies.get(WELCOMED_COOKIE)?.value !== user.id) {
    const welcome = await welcomeStatus(supabase, user.id, pathname, request.method);
    if (welcome === "pending") {
      const url = redirectUrl(clubPath("/bienvenida"), new URLSearchParams({ next: pathname + request.nextUrl.search }));
      return applySessionHeaders(NextResponse.redirect(url), sessionCookies, sessionHeaders);
    }
    welcomedNow = welcome === "completed";
  }

  // The page streams under <Suspense>, so a notFound() there would answer 200: decide the 404 here instead.
  // Same for /foro/tickets/<id>: a ticket that is not the member's (nor supported by them) looks exactly like a missing
  // one. The report queue does not exist either for a member who moderates no channel, nor a settings page they cannot
  // open. /foro/mercado/<id> with an id the page would reject (`../`, uppercase…) is a 404 too.
  // A single unknown segment (/xx) would reach the [lang] layout, whose notFound() streams a 200 too (anonymous visitors
  // went to /foro/login above; the old club segments 308'd at the top). An unknown public giveaway id under /en is a 404 with or without a session.
  // Same for an alias nobody owns (/en/pay/<alias>) and for /pay URLs outside the route map (/pay, /pay/ab).
  if (
    (await isMissingPublicGiveaway(pathname)) ||
    (await isMissingPayAlias(pathname)) ||
    isInvalidPayPath(pathname) ||
    (user &&
      (isUnknownTopSegment(pathname) ||
        (await isMissingChannel(supabase, pathname)) ||
        (await isMissingTicket(supabase, pathname)) ||
        (await isHiddenReportsPage(supabase, pathname)) ||
        (await isHiddenSettingsPage(supabase, pathname)) ||
        (await isHiddenTreasuryPage(supabase, pathname)) ||
        (await isInvalidCoinPage(supabase, pathname))))
  ) {
    return notFound();
  }

  return remember(response);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|sw\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
