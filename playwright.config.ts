import { defineConfig, devices } from "@playwright/test";
import { E2E_SUPER_ADMIN_ADDRESS } from "./e2e/helpers/auth";

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
  webServer: {
    // E2E_PROD=1 runs against a production build (`next build && next start`): no on-demand compile races, which is
    // the closest to what ships. NEXT_PUBLIC_* values are baked at build time, hence the same `env` for both steps.
    command: process.env.E2E_PROD === "1" ? "pnpm build && pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    // Always boot with the E2E env; stop any other server on :3000 first.
    reuseExistingServer: false,
    env,
    timeout: process.env.E2E_PROD === "1" ? 600_000 : 120_000,
  },
});
