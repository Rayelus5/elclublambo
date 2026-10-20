// Security headers for every route (F5-R3/R4), computed once when next.config.ts loads. Pure: no I/O, never throws.
//
// The CSP is static, without nonces: cacheComponents is Partial Prerendering, which the Next 16 CSP guide calls
// incompatible with nonce-based CSP (the prerendered shell's inline scripts cannot carry a per-request nonce). So scripts
// are 'self' 'unsafe-inline' (plus 'unsafe-eval' in dev, which React's dev tooling needs), styles 'self' 'unsafe-inline'
// (AppKit's web components and Tiptap inject styles), and every other directive is an explicit allowlist. The Supabase
// origin and the browser RPC overrides come from NEXT_PUBLIC_* env, so like those they are fixed at build time.

export type HeaderEnv = {
  supabaseUrl: string | undefined;
  siteUrl: string | undefined;
  /** Browser-side RPC overrides (NEXT_PUBLIC_LINEA_*_RPC_URL): tests and local chains only, empty in production. */
  publicRpcUrls: (string | undefined)[];
  dev: boolean;
};

export type SecurityHeader = { key: string; value: string };

/** Child frames: the DexScreener chart of Alpha messages and the iframes the wallet SDK mounts (secure site, Verify). */
export const FRAME_SRC = [
  "https://dexscreener.com",
  "https://secure.walletconnect.org",
  "https://secure.walletconnect.com",
  "https://secure-mobile.walletconnect.org",
  "https://secure-mobile.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://verify.walletconnect.com",
] as const;

/**
 * The networks' public RPCs (viem's `rpcUrls.default` for linea / lineaSepolia). Callers in the browser:
 * - the raffle verifier (src/lib/treasury/raffle-verify-chain.ts) when no NEXT_PUBLIC_ override is set;
 * - wagmi's read transports, which the AppKit WagmiAdapter builds as fallback([customRpcUrls…, Reown RPC when the chain
 *   is supported (Linea mainnet), the chain's default RPC]) (@reown/appkit-utils CaipNetworkUtil.getViemTransport).
 */
const PUBLIC_RPCS = ["https://rpc.linea.build", "https://rpc.sepolia.linea.build"] as const;

/** Reown AppKit / WalletConnect, from node_modules/@reown and @walletconnect. */
const WALLET_CONNECT = [
  "https://api.web3modal.org", // AppKit remote config, wallet list and wallet images
  "https://rpc.walletconnect.org", // Reown blockchain API: wagmi read transport on Linea mainnet, balances
  "https://rpc.walletconnect.com",
  "wss://relay.walletconnect.org", // WalletConnect relay (mobile wallets)
  "wss://relay.walletconnect.com",
  "https://pulse.walletconnect.org", // AppKit events
  "https://verify.walletconnect.org", // Verify API (also framed)
  "https://verify.walletconnect.com",
] as const;

const IMAGE_HOSTS = [
  "https://api.dicebear.com", // default avatars (src/components/members/member-avatar.tsx)
  "https://coin-images.coingecko.com", // coin logos: IMAGE_HOSTS in src/lib/market/coingecko.ts
  "https://assets.coingecko.com",
  "https://api.web3modal.org", // AppKit wallet images
] as const;

const FONT_HOSTS = ["https://fonts.reown.com"] as const; // AppKit ThemeUtil @font-face

/** The URL's origin, or null for anything empty, malformed or not http(s)/ws(s). */
function originOf(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

/** True for an https: URL (the public site URL decides HSTS, upgrade-insecure-requests and Secure cookies). */
export const isHttps = (url: string | undefined) => originOf(url)?.protocol === "https:";

/** The origin plus its WebSocket twin (Realtime): wss: for https:, ws: for http:. */
function withSocket(url: string | undefined): string[] {
  const u = originOf(url);
  if (!u) return [];
  if (u.protocol === "https:") return [u.origin, `wss://${u.host}`];
  if (u.protocol === "http:") return [u.origin, `ws://${u.host}`];
  return [u.origin];
}

const unique = (xs: readonly string[]) => [...new Set(xs)];

export function headerEnvFromProcess(env: NodeJS.ProcessEnv = process.env): HeaderEnv {
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
    publicRpcUrls: [env.NEXT_PUBLIC_LINEA_RPC_URL, env.NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL],
    dev: env.NODE_ENV === "development",
  };
}

export function buildCsp(env: HeaderEnv): string {
  const supabase = originOf(env.supabaseUrl)?.origin;
  const rpcOverrides = env.publicRpcUrls.flatMap((u) => {
    const o = originOf(u)?.origin;
    return o ? [o] : [];
  });

  const directives: [string, readonly string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(env.dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // Supabase: chat images (signed URLs) and avatars (public URLs). data:/blob: for composer previews and AppKit.
    ["img-src", ["'self'", ...(supabase ? [supabase] : []), ...IMAGE_HOSTS, "data:", "blob:"]],
    ["font-src", ["'self'", ...FONT_HOSTS]],
    // Supabase REST, Auth, Storage and Realtime; the public RPCs; test RPC overrides (AppKit customRpcUrls, verifier).
    ["connect-src", ["'self'", ...withSocket(env.supabaseUrl), ...PUBLIC_RPCS, ...rpcOverrides, ...WALLET_CONNECT]],
    ["frame-src", FRAME_SRC],
    ["worker-src", ["'self'"]], // /sw.js (Web Push)
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  // Only over https (F5-R4): local e2e serves http://localhost against http://127.0.0.1:54321.
  if (isHttps(env.siteUrl)) directives.push(["upgrade-insecure-requests", []]);

  return directives.map(([name, sources]) => [name, ...unique(sources)].join(" ")).join("; ");
}

export function securityHeaders(env: HeaderEnv): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: buildCsp(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
    { key: "X-Frame-Options", value: "DENY" },
    // Wallet popups (WalletConnect / AppKit) keep their opener.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
  // HSTS only over https, without preload (F5-R4).
  if (isHttps(env.siteUrl)) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return headers;
}
