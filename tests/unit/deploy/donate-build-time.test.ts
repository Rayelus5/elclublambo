import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Docker build has no runtime secrets (SUPABASE_SERVICE_ROLE_KEY...): the public donate page's service-role reads
// must be request-time. Regression guard for the pre build; also run `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`.
const src = readFileSync(join(process.cwd(), "src/app/(public)/[lang]/donate/page.tsx"), "utf8");

describe("donate page at build time", () => {
  it.each(["getCachedPublicDonationOverview()", "getCachedSafeBalances()"])("awaits connection() before %s", (call) => {
    const at = src.indexOf(call, src.indexOf("async function"));
    const before = src.lastIndexOf("await connection()", at);
    const fnStart = src.lastIndexOf("async function", at);
    expect(before).toBeGreaterThan(fnStart);
  });
});
