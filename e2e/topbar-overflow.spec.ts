import { expect, test, type Page } from "@playwright/test";
import { E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import { createInvite, joinAs } from "./helpers/f2c";

// T-007 (ronda 1): in the desktop top bar the section tabs must never sit under (or overflow into) the controls on the right.
test.describe.configure({ mode: "serial" });

const WIDTHS = [768, 1024, 1280, 1440] as const;

type Box = { name: string; x: number; right: number; top: number; bottom: number };

/** Geometry of the bar: every visible tab, every visible control on the right, and the bar's own overflow. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector("header.sticky")!;
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30), x: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const nav = bar.querySelector('nav[aria-label="Principal"]')!;
    const controls = bar.querySelector('[data-testid="bar-controls"]')!;
    const items = [...nav.querySelectorAll("a, button")].filter(visible).map(box);
    const rightSide = [...controls.querySelectorAll("a, button, [role=img], span.font-mono")].filter(visible).map(box);
    const brand = box(bar.querySelector("a")!);
    return {
      items,
      rightSide,
      controls: box(controls),
      brand,
      navBox: box(nav),
      barOverflow: bar.scrollWidth - bar.clientWidth,
      navOverflow: nav.scrollWidth - nav.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      barRight: bar.getBoundingClientRect().right,
    };
  });
}

const overlap = (a: Box, b: Box) => a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

async function expectClean(page: Page, label: string) {
  const m = await measure(page);
  // A plain member has Inicio, Tickets, Guía and Mercado (P0-R2: «DAO» stays hidden while the legacy DAO is paused).
  expect(m.items.length, `${label}: tabs present`).toBeGreaterThanOrEqual(4);
  for (const it of m.items) {
    expect(it.right, `${label}: «${it.name}» ends before the controls`).toBeLessThanOrEqual(m.controls.x + 0.5);
    expect(it.x, `${label}: «${it.name}» starts after the brand`).toBeGreaterThanOrEqual(m.brand.right - 0.5);
    for (const c of m.rightSide) expect(overlap(it, c), `${label}: «${it.name}» overlaps «${c.name}»`).toBe(false);
  }
  for (let i = 0; i < m.items.length; i++)
    for (let j = i + 1; j < m.items.length; j++) expect(overlap(m.items[i]!, m.items[j]!), `${label}: «${m.items[i]!.name}» overlaps «${m.items[j]!.name}»`).toBe(false);
  for (const c of m.rightSide) expect(c.right, `${label}: «${c.name}» inside the bar`).toBeLessThanOrEqual(m.barRight + 0.5);
  expect(m.barOverflow, `${label}: bar does not overflow`).toBeLessThanOrEqual(0);
  expect(m.navOverflow, `${label}: nav does not overflow`).toBeLessThanOrEqual(0);
  expect(m.pageOverflow, `${label}: no horizontal page scroll`).toBeLessThanOrEqual(0);
  for (const it of m.items) expect(it.bottom - it.top, `${label}: «${it.name}» touch target`).toBeGreaterThanOrEqual(44);
}

/** Simulates a much longer translation: every visible tab label gets a long text. */
async function longLabels(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('header.sticky nav[aria-label="Principal"] a > span.lg\\:not-sr-only, header.sticky nav[aria-label="Principal"] a > span.xl\\:not-sr-only').forEach((s) => {
      s.textContent = (s.textContent ?? "") + " de la comunidad";
    });
  });
}

test("admin: nada se solapa en la barra superior (768-1440 px)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 800 } });
  await loginAs(context, E2E_SUPER_ADMIN_PK);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await expectClean(page, `admin ${width}`);
    // The sections that do not fit are reachable from «Más».
    const more = page.getByRole("button", { name: "Más" });
    await expect(more).toBeVisible();
    await more.click();
    for (const n of ["Miembros", "Reportes", "Ajustes"]) await expect(page.getByRole("menuitem", { name: n })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Ajustes" })).toBeHidden();
    // Long translations: the layout holds (labels only render from 1280 px).
    await longLabels(page);
    await expectClean(page, `admin ${width} (textos largos)`);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  }
  await context.close();
});

test("miembro normal: nada se solapa y no hay «Más» (768-1440 px)", async ({ browser }) => {
  const adminCtx = await browser.newContext();
  await loginAs(adminCtx, E2E_SUPER_ADMIN_PK);
  const adminPage = await adminCtx.newPage();
  const invite = await createInvite(adminPage);
  const member = await joinAs(browser, newWalletKey(), invite, "Miembro barra");
  await member.page.goto("/");
  await expect(member.page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  for (const width of WIDTHS) {
    await member.page.setViewportSize({ width, height: 800 });
    await expectClean(member.page, `miembro ${width}`);
    await expect(member.page.getByRole("button", { name: "Más" })).toHaveCount(0);
  }
  await member.context.close();
  await adminCtx.close();
});
