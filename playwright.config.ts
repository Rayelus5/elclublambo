import { defineConfig, devices } from "@playwright/test";
import { ETH_USD_FEED_ADDRESS, READY_URL, RPC_URL, WETH_ADDRESS } from "./e2e/chain/shared.mjs";
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
  NEXT_PUBLIC_CHAIN: "lineaSepolia",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
  // TEST-ONLY wallet (e2e/helpers/auth.ts), never the real SuperAdmin.
  SUPER_ADMIN_WALLET: E2E_SUPER_ADMIN_ADDRESS,
  // On-chain tips (e2e/f3b-tips.spec.ts): the server verifies against the local Hardhat chain (chain id 59141) and
  // credits after one confirmation. start-chain.mjs below serves it.
  LINEA_SEPOLIA_RPC_URL: RPC_URL,
  // The raffle verifier reads the draw block in the browser: the same local chain (public var, baked at build time).
  NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL: RPC_URL,
  TIP_CONFIRMATIONS: "1",
  // F3d: bearer secret the e2e sends to /api/cron/dao (donation settlement and reconciliation).
  CRON_SECRET: "e2e-cron-secret",
  // F4a: the fund is valued with the local mock Chainlink feed and mock WETH (start-chain.mjs), never a live price.
  ETH_USD_FEED_ADDRESS_59141: ETH_USD_FEED_ADDRESS,
  WETH_ADDRESS_59141: WETH_ADDRESS,
  COINGECKO_DISABLED: "1",
  // F4b: the Mercado pages read the local mock CoinGecko (e2e/mock/coingecko.mjs), never the real API.
  COINGECKO_API_BASE: `http://127.0.0.1:${MOCK_COINGECKO_PORT}/api/v3`,
};
// Make the same values visible to the specs (service-role client, cookie client).
Object.assign(process.env, env);

export default defineConfig({
  testDir: "e2e",
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
      // Local Hardhat node (chain 59141, mock USDC at Linea Sepolia's USDC address). Plain `node`: no shell syntax, so it
      // runs the same from PowerShell, cmd and bash. Ready when it answers on READY_URL (after the mock is deployed).
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
