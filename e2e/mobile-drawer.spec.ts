import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";

// T-001 (ronda 1): the mobile drawer must scroll to the last channel and "Mi perfil".
test.describe.configure({ mode: "serial" });

const LAST = "Canal de prueba 14";

test.beforeAll(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: parent, error } = await db.from("channels").select("id").eq("name", "Comunidad").single<{ id: string }>();
  expect(error).toBeNull();
  const rows = Array.from({ length: 14 }, (_, i) => ({
    parent_id: parent!.id,
    kind: "text",
    name: `Canal de prueba ${i + 1}`,
    position: 100 + i,
  }));
  const { error: insertError } = await db.from("channels").insert(rows);
  expect(insertError).toBeNull();
});

async function openDrawer(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir menú" }).click();
  const drawer = page.getByRole("dialog", { name: "Menú" });
  await expect(drawer).toBeVisible();
  return drawer;
}

for (const [label, size] of [
  ["375x667", { width: 375, height: 667 }],
  ["horizontal 667x375", { width: 667, height: 375 }],
] as const) {
  test(`el cajón se desplaza hasta el último canal y Mi perfil (${label})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, hasTouch: true });
    await loginAs(context, E2E_SUPER_ADMIN_PK);
    const page = await context.newPage();
    const drawer = await openDrawer(page);

    // The content overflows, so the drawer itself must be the scroll container.
    const m = await drawer.evaluate((el) => ({
      scrollable: el.scrollHeight > el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
      overscroll: getComputedStyle(el).overscrollBehaviorY,
    }));
    expect(m.scrollable).toBe(true);
    expect(m.overflowY).toBe("auto");
    expect(m.overscroll).toBe("contain");

    // Scroll with the wheel (what the user does) until the bottom, then the last items must sit inside the viewport.
    const bodyBefore = await page.evaluate(() => window.scrollY);
    await drawer.hover();
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
    const profile = drawer.getByRole("link", { name: /Mi perfil/ });
    const last = drawer.getByRole("link", { name: LAST, exact: true });
    await expect(profile).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(bodyBefore);
    // In a short (landscape) viewport the last channel and the profile block do not fit together: each is reachable.
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });

    // The close button stays pinned while the menu is scrolled to the bottom, and closes the drawer.
    await expect(drawer.getByRole("button", { name: "Cerrar" })).toBeInViewport({ ratio: 1 });

    // Tapping a link closes the drawer.
    await last.click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/c\//);
    await context.close();
  });

  test(`el botón Cerrar sigue fijo tras bajar y cierra el cajón (${label})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, hasTouch: true });
    await loginAs(context, E2E_SUPER_ADMIN_PK);
    const page = await context.newPage();
    const drawer = await openDrawer(page);
    await drawer.hover();
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
    await expect(drawer.getByRole("link", { name: /Mi perfil/ })).toBeInViewport({ ratio: 1 });
    const close = drawer.getByRole("button", { name: "Cerrar" });
    await expect(close).toBeInViewport({ ratio: 1 });
    await close.click();
    await expect(drawer).toBeHidden();
    await context.close();
  });
}
