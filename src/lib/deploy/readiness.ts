// F5-R10: mainnet readiness. `next.config.ts` calls assertProductionReady() so a Vercel production build with a wrong
// configuration fails before anything is deployed. Problems name variables only, never values (they may be secrets).
type Env = Record<string, string | undefined>;

const MUST_BE_UNSET = [
  "ETH_USD_FEED_ADDRESS_59141",
  "WETH_ADDRESS_59141",
  "ETH_USD_FEED_ADDRESS_59144",
  "WETH_ADDRESS_59144",
  "COINGECKO_DISABLED",
  "COINGECKO_API_BASE",
] as const;

const filled = (v: string | undefined) => (v ?? "").trim() !== "";

export function productionEnvProblems(env: Env): string[] {
  const problems: string[] = [];
  if (env.NEXT_PUBLIC_CHAIN !== "linea") problems.push("NEXT_PUBLIC_CHAIN must be linea");
  // Inlined into the client bundle and test-only (security finding S10): a provider key here would ship publicly.
  if (filled(env.NEXT_PUBLIC_LINEA_RPC_URL)) problems.push("NEXT_PUBLIC_LINEA_RPC_URL must be empty");
  if (filled(env.NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL)) problems.push("NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL must be empty");
  for (const name of ["LINEA_RPC_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_REOWN_PROJECT_ID"]) {
    if (!filled(env[name])) problems.push(`${name} is required`);
  }
  // The CSP connect-src and HSTS (headers.ts) depend on these being https.
  if (!(env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://")) problems.push("NEXT_PUBLIC_SITE_URL must be https");
  if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").startsWith("https://")) problems.push("NEXT_PUBLIC_SUPABASE_URL must be https");
  if ((env.CRON_SECRET ?? "").length < 32) problems.push("CRON_SECRET must be at least 32 characters");
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.SUPER_ADMIN_WALLET ?? "")) problems.push("SUPER_ADMIN_WALLET must be a 0x address");
  for (const name of MUST_BE_UNSET) if (filled(env[name])) problems.push(`${name} must be unset in production`);
  const tip = (env.TIP_CONFIRMATIONS ?? "").trim();
  if (tip !== "" && !(/^\d+$/.test(tip) && Number(tip) >= 3)) problems.push("TIP_CONFIRMATIONS must be empty or >= 3");
  return problems;
}

/** Throws when this is a Vercel production build and the configuration is not mainnet-ready; otherwise a no-op. */
export function assertProductionReady(env: Env = process.env): void {
  if (env.VERCEL_ENV !== "production") return;
  const problems = productionEnvProblems(env);
  if (problems.length > 0) throw new Error("Configuración de producción inválida: " + problems.join("; "));
}
