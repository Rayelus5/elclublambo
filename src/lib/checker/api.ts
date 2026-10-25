import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { appChainIds, isChainId, type ChainId } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import { hitIpRateLimit } from "@/lib/rate-limit/ip";
import { safeError } from "@/lib/security/redact";
import { ADDRESS_RE, MAX_QUERY_LENGTH } from "./input";
import { analyzeLink } from "./link/analyze";
import { paidHandler, warnIfMisconfigured, x402Config, type X402Config } from "./x402";

// Shared flow of the public checker API (GET /api/v1/check/{token,link}).

/** The page's disclaimer, verbatim: the API has no language, it answers in the club's (Spanish). */
export const CHECKER_DISCLAIMER = getDictionary("es").checker.disclaimer;

const NO_STORE = { "Cache-Control": "no-store" };
/** api_free (60/h) and api_paid_attempt (300/h) are hourly windows: a limited caller retries in an hour at most. */
const RETRY_AFTER_SECONDS = "3600";

export function apiError(status: number, error: string, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** `?chain=<id>&address=<0x…>`: a chain of this build and a full address. */
export function parseTokenQuery(sp: URLSearchParams): Parsed<{ chain: ChainId; address: `0x${string}` }> {
  const chainParam = sp.get("chain")?.trim() ?? "";
  const n = /^\d{1,7}$/.test(chainParam) ? Number(chainParam) : NaN;
  if (!isChainId(n) || !appChainIds().includes(n)) return { ok: false, error: "invalid_chain" };
  const address = sp.get("address")?.trim() ?? "";
  if (!ADDRESS_RE.test(address)) return { ok: false, error: "invalid_address" };
  return { ok: true, value: { chain: n, address: address as `0x${string}` } };
}

/** `?url=<encoded>`: text the link analyser can parse (the URL is never requested). */
export function parseLinkQuery(sp: URLSearchParams): Parsed<string> {
  const text = sp.get("url")?.trim() ?? "";
  if (text === "" || text.length > MAX_QUERY_LENGTH || !analyzeLink(text, []).ok) return { ok: false, error: "invalid_url" };
  return { ok: true, value: text };
}

type Kind = "token" | "link";

/**
 * The response handler of one check: re-parses the query (it also runs inside withX402, which hands it the request),
 * runs the analysis and answers `{ version, kind, report, disclaimer }`. An analyser failure is a 502 — never charged.
 */
export function checkHandler<T>(kind: Kind, parse: (sp: URLSearchParams) => Parsed<T>, analyze: (value: T) => Promise<unknown>) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const p = parse(request.nextUrl.searchParams);
    if (!p.ok) return apiError(400, p.error);
    try {
      const report = await analyze(p.value);
      return NextResponse.json({ version: 1, kind, report, disclaimer: CHECKER_DISCLAIMER }, { headers: NO_STORE });
    } catch (e) {
      console.error(`[checker-api] ${kind} analysis failed`, safeError(e));
      return apiError(502, "analysis_failed");
    }
  };
}

const DESCRIPTIONS: Record<Kind, string> = {
  token: "ElClub token checker: contract report (code, verification, age, market, alerts)",
  link: "ElClub link checker: local analysis of a link (no request is made to it)",
};

/**
 * Headers carrying a payment: x402 v2's PAYMENT-SIGNATURE and the legacy X-PAYMENT, which @x402/next still accepts.
 * Either one means the facilitator is about to be asked.
 */
const PAYMENT_HEADERS = ["payment-signature", "x-payment"] as const;

/**
 * The paid flow. A request carrying a payment (either header) first charges one loose `api_paid_attempt` hit (300/h per IP) so forged
 * headers cannot hammer the facilitator (429 when limited, 503 when the limiter fails: closed, like the free API); a
 * request without one just gets the 402 (nothing to verify, nothing to count). A handler that cannot be built (the x402
 * modules or the facilitator config failing) is a 503, never an unhandled error. Responses here are never cached.
 */
async function servePaid(request: NextRequest, kind: Kind, cfg: Extract<X402Config, { enabled: true }>, handler: (request: NextRequest) => Promise<NextResponse>): Promise<NextResponse> {
  if (PAYMENT_HEADERS.some((h) => request.headers.has(h))) {
    const limit = await hitIpRateLimit("api_paid_attempt", request.headers);
    if (limit === "rate_limited") return apiError(429, "rate_limited", { "Retry-After": RETRY_AFTER_SECONDS });
    if (limit === "error") return apiError(503, "unavailable");
  }
  let paid: (request: NextRequest) => Promise<NextResponse>;
  try {
    paid = await paidHandler(kind, cfg, handler, DESCRIPTIONS[kind]);
  } catch (e) {
    console.error(`[checker-api] x402 handler for ${kind} could not be built`, safeError(e));
    return apiError(503, "unavailable");
  }
  const res = await paid(request);
  if (res.status === 402) res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * GET of a check: bad parameters → 400 (never charged nor counted). With x402 off, one `api_free` hit (429 +
 * Retry-After when limited, 503 when the limiter fails: the API fails closed) and the free answer. With x402 on, the
 * handler wrapped with withX402 (402 + PAYMENT-REQUIRED without a payment; settled only on < 400), see servePaid.
 */
export async function serveCheck<T>(request: NextRequest, kind: Kind, parse: (sp: URLSearchParams) => Parsed<T>, handler: (request: NextRequest) => Promise<NextResponse>): Promise<NextResponse> {
  const p = parse(request.nextUrl.searchParams);
  if (!p.ok) return apiError(400, p.error);
  const cfg = x402Config();
  if (cfg.enabled) return servePaid(request, kind, cfg, handler);
  warnIfMisconfigured(cfg);
  const limit = await hitIpRateLimit("api_free", request.headers);
  if (limit === "rate_limited") return apiError(429, "rate_limited", { "Retry-After": RETRY_AFTER_SECONDS });
  if (limit === "error") return apiError(503, "unavailable");
  return handler(request);
}
