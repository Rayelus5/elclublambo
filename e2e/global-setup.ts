import { execSync } from "node:child_process";

/**
 * The F1 bootstrap is one-shot and permanent, so the suite needs a pristine database.
 * WARNING: running the E2E suite wipes the LOCAL Supabase database (`supabase db reset`).
 */
export default async function globalSetup() {
  // Escape hatch for fast iteration on a dirty DB (keys are random per run, so specs still pass).
  if (process.env.E2E_SKIP_RESET) return;
  execSync("pnpm db:reset", { stdio: "inherit" });

  // `db reset` restarts the containers: wait until auth and the REST API answer again.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const deadline = Date.now() + 120_000;
  for (const path of ["/auth/v1/health", "/rest/v1/"]) {
    for (;;) {
      try {
        const res = await fetch(base + path, {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
        });
        if (res.ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error(`Supabase did not become ready: ${path}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
