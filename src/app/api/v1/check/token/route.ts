import type { NextRequest } from "next/server";
import { checkHandler, parseTokenQuery, serveCheck } from "@/lib/checker/api";
import { getTokenReport } from "@/lib/checker/token/analyze";

// GET /api/v1/check/token?chain=<id>&address=<0x…> — the token report as JSON (free and IP-limited, or x402).

const handler = checkHandler("token", parseTokenQuery, ({ chain, address }) => getTokenReport(chain, address));

export function GET(request: NextRequest) {
  return serveCheck(request, "token", parseTokenQuery, handler);
}
