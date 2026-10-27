import { describe, expect, it } from "vitest";
import { assertProductionReady, productionEnvProblems } from "@/lib/deploy/readiness";

// F5 Task 7 (F5-R10): the production build refuses a misconfigured environment. Problems name variables, never values.
const valid = {
  NEXT_PUBLIC_NETWORK_SET: "mainnet",
  NEXT_PUBLIC_BASE_BUILDER_CODE: "bc_ttxulybv",
  NEXT_PUBLIC_SITE_URL: "https://elclub.party",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  BASE_RPC_URL: "https://base-mainnet.example/v3/KEY",
  ARBITRUM_RPC_URL: "https://arbitrum-mainnet.example/v3/KEY",
  CRON_SECRET: "a".repeat(32),
  SUPER_ADMIN_WALLET: "0x" + "ab".repeat(20),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  NEXT_PUBLIC_REOWN_PROJECT_ID: "reown",
};

describe("productionEnvProblems", () => {
  it("accepts a complete valid environment", () => {
    expect(productionEnvProblems(valid)).toEqual([]);
    expect(productionEnvProblems({ ...valid, TIP_CONFIRMATIONS: "3" })).toEqual([]);
    expect(productionEnvProblems({ ...valid, TIP_CONFIRMATIONS: "12", NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "" })).toEqual([]);
  });

  const cases: [string, Record<string, string | undefined>, string][] = [
    ["testnet set", { NEXT_PUBLIC_NETWORK_SET: "testnet" }, "NEXT_PUBLIC_NETWORK_SET must be mainnet"],
    ["missing set", { NEXT_PUBLIC_NETWORK_SET: undefined }, "NEXT_PUBLIC_NETWORK_SET must be mainnet"],
    ["empty set", { NEXT_PUBLIC_NETWORK_SET: "" }, "NEXT_PUBLIC_NETWORK_SET must be mainnet"],
    ["public base sepolia rpc", { NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "https://pub/x" }, "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL must be empty"],
    ["public arbitrum sepolia rpc", { NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL: "https://pub/x" }, "NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL must be empty"],
    ["missing base rpc", { BASE_RPC_URL: "" }, "BASE_RPC_URL is required"],
    ["missing arbitrum rpc", { ARBITRUM_RPC_URL: undefined }, "ARBITRUM_RPC_URL is required"],
    ["missing builder code", { NEXT_PUBLIC_BASE_BUILDER_CODE: "" }, "NEXT_PUBLIC_BASE_BUILDER_CODE must be a builder code"],
    ["malformed builder code", { NEXT_PUBLIC_BASE_BUILDER_CODE: "bc ttx!" }, "NEXT_PUBLIC_BASE_BUILDER_CODE must be a builder code"],
    ["33-char builder code", { NEXT_PUBLIC_BASE_BUILDER_CODE: "a".repeat(33) }, "NEXT_PUBLIC_BASE_BUILDER_CODE must be a builder code"],
    ["http site url", { NEXT_PUBLIC_SITE_URL: "http://elclub.party" }, "NEXT_PUBLIC_SITE_URL must be https"],
    ["missing site url", { NEXT_PUBLIC_SITE_URL: undefined }, "NEXT_PUBLIC_SITE_URL must be https"],
    ["http supabase url", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, "NEXT_PUBLIC_SUPABASE_URL must be https"],
    ["missing supabase url", { NEXT_PUBLIC_SUPABASE_URL: "" }, "NEXT_PUBLIC_SUPABASE_URL must be https"],
    ["bare https site url", { NEXT_PUBLIC_SITE_URL: "https://" }, "NEXT_PUBLIC_SITE_URL must be https"],
    ["unparsable site url", { NEXT_PUBLIC_SITE_URL: "https://exa mple.com" }, "NEXT_PUBLIC_SITE_URL must be https"],
    ["bare https supabase url", { NEXT_PUBLIC_SUPABASE_URL: "https://" }, "NEXT_PUBLIC_SUPABASE_URL must be https"],
    ["host-less supabase url", { NEXT_PUBLIC_SUPABASE_URL: "https://:443" }, "NEXT_PUBLIC_SUPABASE_URL must be https"],
    ["short cron secret", { CRON_SECRET: "a".repeat(31) }, "CRON_SECRET must be at least 32 characters"],
    ["missing cron secret", { CRON_SECRET: undefined }, "CRON_SECRET must be at least 32 characters"],
    ["bad super admin", { SUPER_ADMIN_WALLET: "0x123" }, "SUPER_ADMIN_WALLET must be a 0x address"],
    ["missing super admin", { SUPER_ADMIN_WALLET: undefined }, "SUPER_ADMIN_WALLET must be a 0x address"],
    ["missing anon key", { NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"],
    ["missing service role", { SUPABASE_SERVICE_ROLE_KEY: undefined }, "SUPABASE_SERVICE_ROLE_KEY is required"],
    ["missing reown id", { NEXT_PUBLIC_REOWN_PROJECT_ID: " " }, "NEXT_PUBLIC_REOWN_PROJECT_ID is required"],
    ["tip confirmations 2", { TIP_CONFIRMATIONS: "2" }, "TIP_CONFIRMATIONS must be empty or >= 3"],
    ["tip confirmations text", { TIP_CONFIRMATIONS: "abc" }, "TIP_CONFIRMATIONS must be empty or >= 3"],
    ...[
      "ETH_USD_FEED_ADDRESS_59141",
      "WETH_ADDRESS_59141",
      "ETH_USD_FEED_ADDRESS_59144",
      "WETH_ADDRESS_59144",
      "COINGECKO_DISABLED",
      "COINGECKO_API_BASE",
      "NEXT_PUBLIC_CHAIN",
      "LINEA_RPC_URL",
      "LINEA_SEPOLIA_RPC_URL",
      "NEXT_PUBLIC_LINEA_RPC_URL",
      "NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL",
    ].map((n): [string, Record<string, string | undefined>, string] => [`${n} set`, { [n]: "x" }, `${n} must be unset in production`]),
  ];

  it.each(cases)("%s -> exactly its code", (_name, patch, code) => {
    expect(productionEnvProblems({ ...valid, ...patch })).toEqual([code]);
  });
});

describe("assertProductionReady", () => {
  const bad = { ...valid, BASE_RPC_URL: "https://x/v3/TOPSECRET", NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "https://pub/KEY2", CRON_SECRET: "SHORTSECRET" };

  it("is a no-op outside production, however bad the env", () => {
    expect(() => assertProductionReady({ ...bad, VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertProductionReady({ ...bad })).not.toThrow();
    expect(() => assertProductionReady({ VERCEL_ENV: "development" })).not.toThrow();
  });

  it("fails a Vercel build (VERCEL=1) where VERCEL_ENV is missing, naming the variable", () => {
    for (const env of [{ ...valid, VERCEL: "1" }, { ...valid, VERCEL: "1", VERCEL_ENV: "" }]) {
      expect(() => assertProductionReady(env)).toThrow(/VERCEL_ENV is missing/);
    }
    expect(() => assertProductionReady({ ...valid, VERCEL: "1", VERCEL_ENV: "preview" })).not.toThrow();
  });

  it("passes a valid production env", () => {
    expect(() => assertProductionReady({ ...valid, VERCEL_ENV: "production" })).not.toThrow();
  });

  it("throws in production and lists variable names, never values", () => {
    let message = "";
    try {
      assertProductionReady({ ...bad, VERCEL_ENV: "production" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^Configuración de producción inválida: /);
    expect(message).toContain("NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL");
    expect(message).toContain("CRON_SECRET");
    for (const secret of ["TOPSECRET", "KEY2", "SHORTSECRET", "pub/"]) expect(message).not.toContain(secret);
  });
});
