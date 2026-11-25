import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/public-paths";
import { isInternalImagePath, isUnknownTopSegment } from "@/lib/i18n/public-routing";
import { toInternalPath } from "@/lib/i18n/routes";
import { clubPath, clubRelative } from "@/lib/club/paths";
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
import { fetchStatusPage, isInternalStatusRequest, statusFetchOrigin } from "@/lib/admin/status-page";

export async function proxy(request: NextRequest) {
  // The proxy's own fetch of a status page (x-elclub-status: 1, see below): served as it is, ungated, so it cannot loop.
  // Without the header /status/* stays a 404; forging it only shows the status page, which opens nothing.
  if (isInternalStatusRequest(request.nextUrl.pathname, request.method, request.headers)) return NextResponse.next();

  // The fixed public routing is next.config's (src/lib/i18n/route-rules.ts), resolved by the router without running any
  // function: the old club URLs (R1) and direct /es/* visits 308 before the proxy runs, and the Spanish public URLs
  // ("/", "/donar", /herramientas…) are rewritten to the internal /es tree after it. So this proxy sees the public URL.

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

  // Administración (A-R7-A-R9): maintenance closes the site and a switched-off tool answers 503, before the session
  // gates. A direct /es/* URL never gets here: next.config 308s it to its canonical URL first, and that request is
  // gated here. /status/* is only reachable through the proxy itself.
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
      // Next renders a rewritten page with 200 whatever status the rewrite asked for, so the proxy fetches the status
      // page from its own origin and answers it with a real 503. If that fails, the rewrite still shows the page.
      const lang = statusLang(pathname, request.headers.get("accept-language"));
      const kind = maintenance ? "maintenance" : "unavailable";
      const page = await fetchStatusPage({ origin: statusFetchOrigin(request.nextUrl), lang, kind, acceptLanguage: request.headers.get("accept-language") });
      if (page) {
        res = new NextResponse(request.method === "HEAD" ? null : page.body, { status: 503, headers: { ...headers, "Content-Type": page.contentType } });
      } else {
        const url = request.nextUrl.clone();
        url.pathname = `/status/${lang}/${kind}`;
        url.search = "";
        res = NextResponse.rewrite(url, { status: 503, headers, request: { headers: request.headers } });
      }
    } else {
      res = NextResponse.json({ error: maintenance ? "maintenance" : "unavailable" }, { status: 503, headers });
    }
    return remember(applySessionHeaders(res, sessionCookies, sessionHeaders));
  }
  bannerNow = gate.banner;

  // A single unknown segment (/xx, /typo) is the custom 404 for everyone: an anonymous visitor is not invited to sign in
  // to the forum (I1). Club routes, langs, the public ES map and the app's own top-level files are never "unknown".
  if (!user && isUnknownTopSegment(pathname)) return notFound();

  if (!user && !isPublicPath(pathname) && !isInternalImagePath(pathname)) {
    // Only the club asks for a sign-in: /foro/* and /out (its external-link page). Any other unknown URL is the 404 for
    // everyone, deep ones too: scanners probe /wp-admin/…, /.git/… all day, and each login redirect cost a rendered page.
    if (clubRelative(pathname) === null && pathname !== "/out") return notFound();
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
  // got the same 404 above; the old club segments 308'd in next.config). An unknown public giveaway id is a 404 with or
  // without a session, in both languages (checked on the internal path: next.config rewrites the Spanish URL after this).
  // Same for an alias nobody owns (/pay/<alias>, /en/pay/<alias>) and for /pay URLs outside the route map (/pay, /pay/ab).
  const internalPath = toInternalPath(pathname)?.internal ?? pathname;
  if (
    (await isMissingPublicGiveaway(internalPath)) ||
    (await isMissingPayAlias(internalPath)) ||
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

// What skips the proxy (each run is billed Active CPU on Vercel; tests/unit/admin/proxy-matcher.test.ts):
// - Next's own assets and the files that really exist in public/ (the service worker and the brand SVGs). An extension
//   is no exemption: /foro/x.png is a dynamic route like any other and goes through every gate (M1).
// - robots.txt and sitemap.xml, and the share cards of the public tree (/es|/en/…/opengraph-image…): static or cached
//   by the CDN. The maintenance gate already let them through; the card of a switched-off tool is served now too (a
//   public image, nothing to act on).
// - The router's prefetches: 1-2 per <Link> in view, they multiplied the proxy runs by 8-24 per visit. Only a real one
//   skips it: next-router-prefetch together with rsc: 1, which Next answers with the RSC prefetch payload (the App Shell),
//   never the HTML page. A GET that only carries next-router-prefetch is rendered as a full page, so it runs the proxy
//   (the second entry), and so does a browser document prefetch (purpose: prefetch). The navigation itself carries no
//   prefetch header and is gated as before; layouts check the session.
// - /api/cron/*: the handler authenticates itself (bearer CRON_SECRET) and the gates let it through anyway.
// Server Actions (next-action, or a form POST) and the other APIs always run it, so a forged prefetch header cannot skip
// the maintenance gate or a tool switch. The values must be literals (Next reads them at build time).
export const config = {
  matcher: [
    {
      source:
        "/((?!_next/|favicon\\.ico$|sw\\.js$|brand/[^/]+/[^/]+\\.svg$|robots\\.txt$|sitemap\\.xml$|api/|(?:es|en)/(?:.*/)?(?:opengraph|twitter)-image(?:-[a-z0-9]+)?$).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
    {
      source:
        "/((?!_next/|favicon\\.ico$|sw\\.js$|brand/[^/]+/[^/]+\\.svg$|robots\\.txt$|sitemap\\.xml$|api/|(?:es|en)/(?:.*/)?(?:opengraph|twitter)-image(?:-[a-z0-9]+)?$).*)",
      has: [{ type: "header", key: "next-router-prefetch" }],
      missing: [{ type: "header", key: "rsc", value: "1" }],
    },
    {
      source:
        "/((?!_next/|favicon\\.ico$|sw\\.js$|brand/[^/]+/[^/]+\\.svg$|robots\\.txt$|sitemap\\.xml$|api/|(?:es|en)/(?:.*/)?(?:opengraph|twitter)-image(?:-[a-z0-9]+)?$).*)",
      has: [{ type: "header", key: "next-action" }],
    },
    {
      source:
        "/((?!_next/|favicon\\.ico$|sw\\.js$|brand/[^/]+/[^/]+\\.svg$|robots\\.txt$|sitemap\\.xml$|api/|(?:es|en)/(?:.*/)?(?:opengraph|twitter)-image(?:-[a-z0-9]+)?$).*)",
      has: [{ type: "header", key: "content-type", value: "multipart/form-data.*" }],
    },
    {
      source:
        "/((?!_next/|favicon\\.ico$|sw\\.js$|brand/[^/]+/[^/]+\\.svg$|robots\\.txt$|sitemap\\.xml$|api/|(?:es|en)/(?:.*/)?(?:opengraph|twitter)-image(?:-[a-z0-9]+)?$).*)",
      has: [{ type: "header", key: "content-type", value: "application/x-www-form-urlencoded.*" }],
    },
    "/api/((?!cron(?:/|$)).*)",
  ],
};
