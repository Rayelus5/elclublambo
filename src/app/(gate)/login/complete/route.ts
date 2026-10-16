import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/public-paths";
import { completeLogin } from "@/lib/auth/actions";

/**
 * Finishes a login whose session cookies already exist (non-JS fallback and E2E entry point):
 * runs the same gatekeeping as the login panel and redirects to the outcome.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const result = await completeLogin(searchParams.get("invite"));
  const target = result.redirectTo === "/" ? safeNextPath(searchParams.get("next")) : result.redirectTo;
  return NextResponse.redirect(new URL(target, request.nextUrl.origin));
}
