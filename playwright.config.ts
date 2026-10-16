import { defineConfig, devices } from "@playwright/test";
import { E2E_SUPER_ADMIN_ADDRESS } from "./e2e/helpers/auth";

// Supabase keys come from .env.local (git-ignored); already-set process env wins.
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides the variables directly.
}

const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  NEXT_PUBLIC_REOWN_PROJECT_ID: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "",
  NEXT_PUBLIC_CHAIN: "lineaSepolia",
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
    command: "pnpm dev",
    url: "http://localhost:3000",
    // Always boot with the E2E env; stop any other server on :3000 first.
    reuseExistingServer: false,
    env,
    timeout: 120_000,
  },
});
