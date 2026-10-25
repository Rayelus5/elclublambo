import type { NextRequest } from "next/server";
import { checkHandler, parseLinkQuery, serveCheck } from "@/lib/checker/api";
import { getKnownDomains } from "@/lib/checker/link/allowed";
import { analyzeLink } from "@/lib/checker/link/analyze";

// GET /api/v1/check/link?url=<encoded> — the local link analysis as JSON (the URL is never requested).

const handler = checkHandler("link", parseLinkQuery, async (url) => analyzeLink(url, await getKnownDomains()));

export function GET(request: NextRequest) {
  return serveCheck(request, "link", parseLinkQuery, handler);
}
