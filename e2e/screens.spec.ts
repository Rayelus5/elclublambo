import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext } from "@playwright/test";
import { E2E_SUPER_ADMIN_ADDRESS, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";

// Opt-in visual pass: `SCREENS=1 pnpm test:e2e e2e/screens.spec.ts` (or --grep @screens).
// Writes screenshots to .superpowers/sdd/f1/screens/ (git-ignored) and checks there is no
// horizontal scroll at any width.
test.skip(!process.env.SCREENS, "set SCREENS=1 to capture screenshots");

const OUT = ".superpowers/sdd/f1/screens";
const WIDTHS = [375, 768, 1024, 1440] as const;
const adminAddr = E2E_SUPER_ADMIN_ADDRESS.toLowerCase();

test.describe.configure({ mode: "serial" });

let anon: BrowserContext;
let admin: BrowserContext;
let targets: Array<{ name: string; ctx: BrowserContext; path: string }>;

test.beforeAll(async ({ browser }) => {
  // Anonymous: /login and an invite landing.
  anon = await browser.newContext();
  admin = await browser.newContext();
  await loginAs(admin, E2E_SUPER_ADMIN_PK);
  const adminPage = await admin.newPage();

  await adminPage.goto("/invites");
  await adminPage.getByRole("button", { name: "Crear invitación" }).click();
  const url = await adminPage.getByLabel("Tu enlace de invitación").inputValue();
  const code = url.split("/invite/")[1]!;
  await adminPage.close();

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: general } = await db.from("channels").select("id").eq("name", "General").single<{ id: string }>();

  // F2d: messages for the palette capture (it searches "ayuda": action, channel and message groups all answer).
  const { data: me } = await db.from("members").select("id").eq("wallet_address", adminAddr).single<{ id: string }>();
  const text = "Necesito ayuda con la Línea de tiempo del proyecto, ¿alguien sabe cómo se configura el calendario?";
  await db.from("messages").insert({
    channel_id: general!.id,
    author_id: me!.id,
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    body_text: text,
    allow_links: false,
  });

  targets = [
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
    // F2c (empty states; the data-backed captures live in f2c-notify / f2c-support)
    { name: "notifications", ctx: admin, path: "/notifications" },
    { name: "tickets", ctx: admin, path: "/tickets" },
    { name: "reports", ctx: admin, path: "/moderation/reports" },
  ];
});

test.afterAll(async () => {
  await anon?.close();
  await admin?.close();
});

// One test per width: a failure points at one viewport and each stays well inside its own timeout (12 pages, each
// waiting for the network to settle on a server that may compile routes on demand).
for (const width of WIDTHS) {
  test(`@screens capture the F1/F2 pages at ${width}px`, async () => {
    test.setTimeout(240_000);
    mkdirSync(OUT, { recursive: true });
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
  });
}

// F2d: the Cmd+K palette open with results (actions, channels and messages), at the narrowest and widest widths.
for (const width of [375, 1440] as const) {
  test(`@screens capture the command palette at ${width}px`, async () => {
    const page = await admin.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "Buscar" });
    // Right after the navigation the app may not be hydrated yet: retry the opener until it answers.
    await expect(async () => {
      if (width === 375) await page.getByRole("banner").getByRole("button", { name: "Buscar" }).click({ timeout: 1_500 });
      else await page.keyboard.press("Control+K");
      await expect(dialog).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await dialog.getByRole("combobox").fill("ayuda");
    await expect(dialog.getByRole("option").filter({ hasText: "Línea de tiempo" })).toBeVisible();
    await expect(dialog.getByRole("group", { name: "Acciones" })).toBeVisible();
    await expect(dialog.getByRole("group", { name: "Canales" })).toBeVisible();
    mkdirSync(".superpowers/sdd/f2d/screens", { recursive: true });
    await page.screenshot({ path: ".superpowers/sdd/f2d/screens/palette-" + width + ".png" });
    if (width === 375) {
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(375);
    }
    await page.close();
  });
}
