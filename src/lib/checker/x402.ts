import "server-only";
import type { NextRequest, NextResponse } from "next/server";

// Optional pay-per-query for the checker API (x402 v2). OFF by default everywhere (D17: no real money without the
// fiscal sign-up). P4-R4: each environment decides through env vars; P4-R5: `withX402` wraps the route handler so a
// payment is settled only when the handler answers < 400 (an error is never charged).

export type X402Network = "eip155:84532" | "eip155:8453";
const NETWORKS: readonly X402Network[] = ["eip155:84532", "eip155:8453"];

/** The club Safe (P4-R4 default payee). */
export const CLUB_SAFE = "0x380f2e12081995359e2Ab88E3c31c6b227904234";
export const DEFAULT_PRICE = "$0.01";
/** Public testnet facilitator (Base Sepolia only, no key). */
export const PUBLIC_FACILITATOR_URL = "https://x402.org/facilitator";

export type X402DisabledReason = "disabled" | "unsupported_network" | "missing_cdp_keys" | "invalid_price" | "invalid_pay_to" | "invalid_facilitator_url";

export type X402Config =
  | { enabled: false; reason: X402DisabledReason }
  | { enabled: true; network: "eip155:84532"; price: string; payTo: `0x${string}`; facilitator: "public"; facilitatorUrl: string }
  | { enabled: true; network: "eip155:8453"; price: string; payTo: `0x${string}`; facilitator: "cdp" };

type Env = Record<string, string | undefined>;

// USD price in dollars: positive, at most 6 decimals (USDC), below $100 so a typo cannot ask for a fortune.
const PRICE_RE = /^\$\d{1,2}(\.\d{1,6})?$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function httpsUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const off = (reason: X402DisabledReason) => ({ enabled: false, reason }) as const;

/** The x402 settings of this environment. Pure; the CDP secret is only checked for presence, never copied. */
export function x402Config(env: Env = process.env): X402Config {
  if (env.X402_ENABLED?.trim().toLowerCase() !== "true") return off("disabled");
  const network = (env.X402_NETWORK?.trim() || "eip155:84532") as X402Network;
  if (!NETWORKS.includes(network)) return off("unsupported_network");
  const price = env.X402_PRICE?.trim() || DEFAULT_PRICE;
  if (!PRICE_RE.test(price) || Number(price.slice(1)) <= 0) return off("invalid_price");
  const payTo = env.X402_PAY_TO?.trim() || CLUB_SAFE;
  if (!ADDRESS_RE.test(payTo)) return off("invalid_pay_to");
  const pay = { price, payTo: payTo as `0x${string}` };
  if (network === "eip155:8453") {
    if (!env.CDP_API_KEY_ID?.trim() || !env.CDP_API_KEY_SECRET?.trim()) return off("missing_cdp_keys");
    return { enabled: true, network, ...pay, facilitator: "cdp" };
  }
  const facilitatorUrl = httpsUrl(env.X402_FACILITATOR_URL?.trim() || PUBLIC_FACILITATOR_URL);
  if (!facilitatorUrl) return off("invalid_facilitator_url");
  return { enabled: true, network, ...pay, facilitator: "public", facilitatorUrl };
}

const warned = new Set<X402DisabledReason>();

/** x402 was asked for (X402_ENABLED=true) but the config is unusable: the API stays free and says so once per reason. */
export function warnIfMisconfigured(cfg: X402Config): void {
  if (cfg.enabled || cfg.reason === "disabled" || warned.has(cfg.reason)) return;
  warned.add(cfg.reason);
  console.warn(`[x402] X402_ENABLED=true but the checker API stays free: ${cfg.reason}`);
}

type Handler = (request: NextRequest) => Promise<NextResponse>;

/** Facilitator timeout: well under the platform's function limit. */
const FACILITATOR_TIMEOUT_MS = 15_000;

async function buildPaid(cfg: Extract<X402Config, { enabled: true }>, handler: Handler, description: string, env: Env): Promise<Handler> {
  // Loaded on the first paid request only: nothing of x402 runs at build or import time, nor on the free path.
  const [{ withX402, x402ResourceServer }, { HTTPFacilitatorClient }, { ExactEvmScheme }] = await Promise.all([
    import("@x402/next"),
    import("@x402/core/server"),
    import("@x402/evm/exact/server"),
  ]);
  const facilitatorConfig =
    cfg.facilitator === "cdp"
      ? (await import("@coinbase/x402")).createFacilitatorConfig(env.CDP_API_KEY_ID?.trim(), env.CDP_API_KEY_SECRET?.trim())
      : { url: cfg.facilitatorUrl };
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ ...facilitatorConfig, timeoutMs: FACILITATOR_TIMEOUT_MS })).register(
    cfg.network,
    new ExactEvmScheme(),
  );
  // A bare route config (no path key) applies to whatever path the handler serves. The facilitator's /supported is
  // fetched on this first request (and retried on the next one if it fails).
  return withX402(
    handler,
    {
      accepts: { scheme: "exact", price: cfg.price, network: cfg.network, payTo: cfg.payTo },
      description,
      mimeType: "application/json",
      unpaidResponseBody: () => ({ contentType: "application/json", body: { error: "payment_required" } }),
    },
    server,
  );
}

const paid = new Map<string, Promise<Handler>>();

/**
 * The handler wrapped with x402 for `cfg`, built once per (route, config) and reused. A failed build is forgotten so
 * the next request retries it.
 */
export function paidHandler(key: string, cfg: Extract<X402Config, { enabled: true }>, handler: Handler, description: string, env: Env = process.env): Promise<Handler> {
  const k = `${key}|${JSON.stringify(cfg)}`;
  let p = paid.get(k);
  if (!p) {
    p = buildPaid(cfg, handler, description, env);
    paid.set(k, p);
    p.catch(() => paid.delete(k));
  }
  return p;
}
