import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { E2E_SUPER_ADMIN_ADDRESS, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";

// Opt-in visual pass: `SCREENS=1 pnpm test:e2e e2e/screens.spec.ts` (or --grep @screens).
// Writes screenshots to .superpowers/sdd/f1/screens/ (git-ignored) and checks there is no
// horizontal scroll at any width.
test.skip(!process.env.SCREENS, "set SCREENS=1 to capture screenshots");

const OUT = ".superpowers/sdd/f1/screens";
const WIDTHS = [375, 768, 1024, 1440] as const;
const adminAddr = E2E_SUPER_ADMIN_ADDRESS.toLowerCase();

test("@screens capture the F1 pages at 375/768/1024/1440", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });

  // Anonymous: /login and an invite landing.
  const anon = await browser.newContext();
  const admin = await browser.newContext();
  await loginAs(admin, E2E_SUPER_ADMIN_PK);
  const adminPage = await admin.newPage();

  await adminPage.goto("/invites");
  await adminPage.getByRole("button", { name: "Crear invitación" }).click();
  const url = await adminPage.getByLabel("Tu enlace de invitación").inputValue();
  const code = url.split("/invite/")[1]!;

  const { data: general } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
    .from("channels")
    .select("id")
    .eq("name", "General")
    .single<{ id: string }>();

  const targets = [
    { name: "login", ctx: anon, path: "/login" },
    { name: "invite", ctx: anon, path: `/invite/${code}` },
    { name: "home", ctx: admin, path: "/" },
    { name: "invites", ctx: admin, path: "/invites" },
    { name: "profile", ctx: admin, path: `/u/${adminAddr}` },
    { name: "members", ctx: admin, path: "/admin/members" },
    // F2a
    { name: "channel", ctx: admin, path: `/c/${general!.id}` },
    { name: "settings-channels", ctx: admin, path: "/settings/channels" },
    { name: "settings-roles", ctx: admin, path: "/settings/roles" },
  ];

  for (const width of WIDTHS) {
    for (const t of targets) {
      const page = await t.ctx.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(t.path);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/${t.name}-${width}.png`, fullPage: true });
      if (width === 375) {
        const scrollWidth = await page.evaluate(() => document.scrollingElement!.scrollWidth);
        expect(scrollWidth, `${t.name} overflows horizontally at 375px`).toBeLessThanOrEqual(375);
        if (t.ctx === admin) {
          // The mobile top bar must keep its natural height (not stretch with the grid rows).
          const header = await page.getByRole("banner").boundingBox();
          expect(header?.height ?? Infinity, `${t.name} mobile header height`).toBeLessThanOrEqual(80);
        }
      }
      await page.close();
    }
  }
  await anon.close();
  await admin.close();
});
