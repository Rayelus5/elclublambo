import type { NextRequest } from "next/server";
import { checkHandler, parseTokenQuery, serveCheck } from "@/lib/checker/api";
import { getTokenReport, SourcesDown, totalFailure } from "@/lib/checker/token/analyze";

// GET /api/v1/check/token?chain=<id>&address=<0x…> — the token report as JSON (free and IP-limited, or x402).

// A report where no source answered is a failure (502), not an answer: in paid mode it must never be settled.
const handler = checkHandler("token", parseTokenQuery, async ({ chain, address }) => {
  const report = await getTokenReport(chain, address);
  if (totalFailure(report.facts)) throw new SourcesDown();
  return report;
});

export function GET(request: NextRequest) {
  return serveCheck(request, "token", parseTokenQuery, handler);
}
