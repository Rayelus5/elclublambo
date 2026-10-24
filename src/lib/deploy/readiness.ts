// F5-R10: mainnet readiness. `next.config.ts` calls assertProductionReady() so a Vercel production build with a wrong
// configuration fails before anything is deployed. Problems name variables only, never values (they may be secrets).
import { BUILDER_CODE_RE } from "../web3/builder-code-format";

type Env = Record<string, string | undefined>;

const MUST_BE_UNSET = [
  // Pre-Base configuration that may linger in Vercel: nothing reads it any more.
  "NEXT_PUBLIC_CHAIN",
  "LINEA_RPC_URL",
  "LINEA_SEPOLIA_RPC_URL",
  "NEXT_PUBLIC_LINEA_RPC_URL",
  "NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL",
  "ETH_USD_FEED_ADDRESS_59141",
  "WETH_ADDRESS_59141",
  "ETH_USD_FEED_ADDRESS_59144",
  "WETH_ADDRESS_59144",
  "COINGECKO_DISABLED",
  "COINGECKO_API_BASE",
] as const;

/** True for a parseable https URL with a non-empty host (a bare "https://" is not one). */
function isHttpsUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

const filled = (v: string | undefined) => (v ?? "").trim() !== "";

export function productionEnvProblems(env: Env): string[] {
  const problems: string[] = [];
  // An empty or missing set means testnet, so only the literal "mainnet" is ready.
  if (env.NEXT_PUBLIC_NETWORK_SET !== "mainnet") problems.push("NEXT_PUBLIC_NETWORK_SET must be mainnet");
  // Inlined into the client bundle and test-only (security finding S10): a provider key here would ship publicly.
  if (filled(env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL)) problems.push("NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL must be empty");
  if (filled(env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL)) problems.push("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL must be empty");
  // Public by design (it is inlined into every Base transaction), but a typo would tag transactions with a wrong code.
  if (!BUILDER_CODE_RE.test((env.NEXT_PUBLIC_BASE_BUILDER_CODE ?? "").trim())) {
    problems.push("NEXT_PUBLIC_BASE_BUILDER_CODE must be a builder code");
  }
  for (const name of ["BASE_RPC_URL", "ARBITRUM_RPC_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_REOWN_PROJECT_ID"]) {
    if (!filled(env[name])) problems.push(`${name} is required`);
  }
  // The CSP connect-src and HSTS (headers.ts) depend on these being https.
  if (!isHttpsUrl(env.NEXT_PUBLIC_SITE_URL)) problems.push("NEXT_PUBLIC_SITE_URL must be https");
  if (!isHttpsUrl(env.NEXT_PUBLIC_SUPABASE_URL)) problems.push("NEXT_PUBLIC_SUPABASE_URL must be https");
  if ((env.CRON_SECRET ?? "").length < 32) problems.push("CRON_SECRET must be at least 32 characters");
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.SUPER_ADMIN_WALLET ?? "")) problems.push("SUPER_ADMIN_WALLET must be a 0x address");
  for (const name of MUST_BE_UNSET) if (filled(env[name])) problems.push(`${name} must be unset in production`);
  const tip = (env.TIP_CONFIRMATIONS ?? "").trim();
  if (tip !== "" && !(/^\d+$/.test(tip) && Number(tip) >= 3)) problems.push("TIP_CONFIRMATIONS must be empty or >= 3");
  return problems;
}

/** Throws when this is a Vercel production build and the configuration is not mainnet-ready; otherwise a no-op. */
export function assertProductionReady(env: Env = process.env): void {
  // On Vercel (VERCEL=1) VERCEL_ENV must exist; otherwise every production build would silently skip this check.
  if (env.VERCEL === "1" && !filled(env.VERCEL_ENV)) {
    throw new Error("VERCEL_ENV is missing (enable 'Automatically expose System Environment Variables')");
  }
  if (env.VERCEL_ENV !== "production") return;
  const problems = productionEnvProblems(env);
  if (problems.length > 0) throw new Error("Configuración de producción inválida: " + problems.join("; "));
}
