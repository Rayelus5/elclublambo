import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/public-paths";
import { completeLogin } from "@/lib/auth/actions";
import { clubPath } from "@/lib/club/paths";
import { publicOrigin } from "@/lib/start/site";

/**
 * Finishes a login whose session cookies already exist (non-JS fallback and E2E entry point):
 * runs the same gatekeeping as the login panel and redirects to the outcome.
 *
 * It changes state (redeems invites, bootstraps the admin) on a GET, so it only runs for
 * navigations that originate from the user themselves (`Sec-Fetch-Site: same-origin | none`);
 * a cross-site link or image can never trigger it.
 *
 * Every redirect is built on the public origin: behind the tunnel the request URL is the bind address (0.0.0.0:3000).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = publicOrigin(request);
  const home = clubPath();
  const login = clubPath("/login");
  const noAccess = clubPath("/no-access");

  const site = request.headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "none") {
    return NextResponse.redirect(new URL(login, origin));
  }

  // P2-R16: the public connect comes back here (?mode=public): no invite, any non-banned wallet goes back to `next`
  // (by default the landing, R1-R4). A lost session (the club login) goes back to `next` too: the public page offers to
  // connect again (the club login does not).
  if (searchParams.get("mode") === "public") {
    const { redirectTo } = await completeLogin(null, "public");
    const back = redirectTo === "public" || redirectTo === login;
    const target = new URL(back ? safeNextPath(searchParams.get("next"), "/") : redirectTo, origin);
    return NextResponse.redirect(target.origin === origin ? target : new URL("/", origin));
  }

  const result = await completeLogin(searchParams.get("invite"));
  // Same hand-off as the login panel: the club home honours a safe `next`; /foro/no-access takes the specific error.
  const wanted =
    result.redirectTo === home
      ? safeNextPath(searchParams.get("next"))
      : result.error && result.redirectTo === noAccess
        ? `${noAccess}?error=${encodeURIComponent(result.error)}`
        : result.redirectTo;
  const target = new URL(wanted, origin);
  return NextResponse.redirect(target.origin === origin ? target : new URL(home, origin));
}
