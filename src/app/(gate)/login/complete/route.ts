import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/public-paths";
import { completeLogin } from "@/lib/auth/actions";

/**
 * Finishes a login whose session cookies already exist (non-JS fallback and E2E entry point):
 * runs the same gatekeeping as the login panel and redirects to the outcome.
 *
 * It changes state (redeems invites, bootstraps the admin) on a GET, so it only runs for
 * navigations that originate from the user themselves (`Sec-Fetch-Site: same-origin | none`);
 * a cross-site link or image can never trigger it.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;

  const site = request.headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "none") {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const result = await completeLogin(searchParams.get("invite"));
  const wanted = result.redirectTo === "/" ? safeNextPath(searchParams.get("next")) : result.redirectTo;
  const target = new URL(wanted, origin);
  return NextResponse.redirect(target.origin === origin ? target : new URL("/", origin));
}
