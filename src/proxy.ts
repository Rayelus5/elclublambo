import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/public-paths";
import { applySessionHeaders } from "@/lib/auth/session-headers";
import { isMissingChannel, NOT_FOUND_PATH } from "@/lib/channels/guard";
import { isHiddenReportsPage } from "@/lib/reports/guard";
import { isMissingTicket } from "@/lib/tickets/guard";

export async function proxy(request: NextRequest) {
  // Layouts do not receive the pathname: the forum layout reads it from this header (onboarding redirect keeps `next`).
  // Set on the request itself (overwrites anything the client sent) so the cookie refresh below still forwards with it.
  request.headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request });
  let sessionCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];
  let sessionHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  const { pathname } = request.nextUrl;
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return applySessionHeaders(NextResponse.redirect(url), sessionCookies, sessionHeaders);
  }

  // The page streams under <Suspense>, so a notFound() there would answer 200: decide the 404 here instead.
  // Same for /tickets/<id>: a ticket that is not the member's (nor supported by them) looks exactly like a missing one.
  // The report queue does not exist either for a member who moderates no channel.
  if (
    user &&
    ((await isMissingChannel(supabase, pathname)) ||
      (await isMissingTicket(supabase, pathname)) ||
      (await isHiddenReportsPage(supabase, pathname)))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = NOT_FOUND_PATH;
    url.search = "";
    return applySessionHeaders(NextResponse.rewrite(url, { status: 404 }), sessionCookies, sessionHeaders);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|sw\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
