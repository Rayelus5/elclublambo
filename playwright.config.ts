import { defineConfig, devices } from "@playwright/test";
import { CHAINS, READY_URL } from "./e2e/chain/shared.mjs";
import { E2E_SUPER_ADMIN_ADDRESS } from "./e2e/helpers/auth";
import { MOCK_PORT as MOCK_COINGECKO_PORT } from "./e2e/mock/coingecko.mjs";

// Supabase keys come from .env.local (git-ignored); already-set process env wins.
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides the variables directly.
}

// TEST-ONLY VAPID PUBLIC key (throwaway pair; the private half was discarded and is not needed). It only makes the
// push toggle render in e2e 3a, which stubs the browser push API; nothing is ever sent to it.
const E2E_VAPID_PUBLIC_KEY =
  "BOT-HvCnB1tU7LWtWnpH3pCfniQoHh09sf08J5-dKz0aNM3h3qJ1JVCzRWwrwpnjyICc7px2r8xlFattTzW5weg";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  NEXT_PUBLIC_REOWN_PROJECT_ID: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "",
  // P0-R1: the testnet set (Base Sepolia 84532 and Arbitrum Sepolia 421614), the one PRE and local use.
  NEXT_PUBLIC_NETWORK_SET: "testnet",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
  // TEST-ONLY wallet (e2e/helpers/auth.ts), never the real SuperAdmin.
  SUPER_ADMIN_WALLET: E2E_SUPER_ADMIN_ADDRESS,
  // On-chain tips and bounties (e2e/f3b-tips.spec.ts, e2e/f3c-bounties.spec.ts): the server verifies against the two
  // local Hardhat nodes (start-chain.mjs below) and credits after one confirmation.
  BASE_SEPOLIA_RPC_URL: CHAINS[84532].rpcUrl,
  ARBITRUM_SEPOLIA_RPC_URL: CHAINS[421614].rpcUrl,
  // The browser reads balances from the same nodes (public vars, baked at build time; empty in production).
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: CHAINS[84532].rpcUrl,
  NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL: CHAINS[421614].rpcUrl,
  TIP_CONFIRMATIONS: "1",
  // P0-R6: TEST-ONLY Builder Code; f3b checks the ERC-8021 suffix it puts on Base transfers.
  NEXT_PUBLIC_BASE_BUILDER_CODE: "bc_e2etest",
  // F3d: bearer secret the e2e sends to /api/cron/dao (donation settlement and reconciliation).
  CRON_SECRET: "e2e-cron-secret",
  // F4b: the Mercado pages read the local mock CoinGecko (e2e/mock/coingecko.mjs), never the real API.
  COINGECKO_API_BASE: `http://127.0.0.1:${MOCK_COINGECKO_PORT}/api/v3`,
};
// Make the same values visible to the specs (service-role client, cookie client).
Object.assign(process.env, env);

export default defineConfig({
  testDir: "e2e",
  // P0-R2: se reescriben en P1. The legacy DAO / raffle / poll specs still target Linea and the paused DAO.
  testIgnore: ["legacy/**"],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // `open: never` so a failure never leaves the html report server blocking the process.
  reporter: [["list"], ["html", { open: "never" }]],
  workers: 1,
  fullyParallel: false,
  use: { baseURL: "http://localhost:3000" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Two local Hardhat nodes (P0-R13): 84532 on :8545 and 421614 on :8546, each with a mock USDC at Circle's address for
      // that testnet. Plain `node`: no shell syntax, so it runs the same from PowerShell, cmd and bash. Ready when it
      // answers on READY_URL (after both mocks are deployed).
      command: "node e2e/chain/start-chain.mjs",
      url: READY_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // F4b: local mock CoinGecko (deterministic fixtures, POST /__fail and /__ok toggle a 503 outage).
      command: "node e2e/mock/coingecko.mjs",
      url: `http://127.0.0.1:${MOCK_COINGECKO_PORT}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // E2E_PROD=1 runs against a production build (`next build && next start`): no on-demand compile races, which is
      // the closest to what ships. NEXT_PUBLIC_* values are baked at build time, hence the same `env` for both steps.
      command: process.env.E2E_PROD === "1" ? "pnpm build && pnpm start" : "pnpm dev",
      url: "http://localhost:3000",
      // Always boot with the E2E env; stop any other server on :3000 first.
      reuseExistingServer: false,
      env,
      timeout: process.env.E2E_PROD === "1" ? 600_000 : 120_000,
    },
  ],
});
