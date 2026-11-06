import { type Page, expect, test } from '@playwright/test';

// The access backdrop (DESIGN_SYSTEM §8): real engine galaxies, composed in WebGL2 (or 2D without it), never more
// than two layers, one still layer with reduced motion, and nothing the game's CSP blocks.
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

/** How many pixels of the first drawn galaxy layer are clearly lit (sampled at 96 × 96). */
function litPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLCanvasElement>('.backdrop canvas[data-drawn]');
    if (!layer) return 0;
    const probe = document.createElement('canvas');
    probe.width = 96;
    probe.height = 96;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(layer, 0, 0, 96, 96);
    const d = ctx.getImageData(0, 0, 96, 96).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 90) lit++;
    return lit;
  });
}

test('el fondo de acceso dibuja una galaxia del motor en dos capas y sin violar la CSP', async ({ page }) => {
  const csp = watchCsp(page);
  await page.goto('/galaxy/entrar');
  await expect(page.getByRole('heading', { name: 'Vuelve a tu estación' })).toBeVisible();
  await expect(page.locator('.backdrop canvas[data-drawn]').first()).toBeAttached({ timeout: 15_000 });
  // Two layers for the cross-fade; each canvas is created when its galaxy is drawn.
  expect(await page.locator('.backdrop .layer').count()).toBe(2);
  expect(await page.locator('.backdrop canvas').count()).toBeLessThanOrEqual(2);
  expect(await litPixels(page)).toBeGreaterThan(20);
  expect(csp).toEqual([]);
});

test('el fondo usa un solo contexto WebGL compartido y no guarda galaxias en el disco', async ({ page }) => {
  // Count the WebGL2 contexts the page creates (the backdrop composes every galaxy in one shared canvas).
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    const contexts = new Set<unknown>();
    (window as unknown as { webglContexts: () => number }).webglContexts = () => contexts.size;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (type === 'webgl2' && ctx) contexts.add(ctx);
      return ctx;
    } as typeof original;
  });
  await page.goto('/galaxy/entrar');
  // The second galaxy is prepared as soon as the first is shown, into the other layer.
  await expect(page.locator('.backdrop canvas[data-drawn]')).toHaveCount(2, { timeout: 25_000 });
  const layers = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>('.backdrop canvas')].map((c) => c.getContext('2d') !== null),
  );
  expect(layers).toEqual([true, true]); // plain 2D layers, fed from the shared WebGL canvas
  expect(await page.evaluate(() => (window as unknown as { webglContexts: () => number }).webglContexts())).toBe(1);
  const stored = await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    return dbs.map((d) => d.name);
  });
  expect(stored).not.toContain('galaxy-cache');
});

test.describe('con movimiento reducido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('hay una sola galaxia, quieta', async ({ page }) => {
    await page.goto('/galaxy/entrar');
    await expect(page.locator('.backdrop canvas[data-drawn]')).toBeAttached({ timeout: 15_000 });
    expect(await page.locator('.backdrop .layer').count()).toBe(1);
    expect(await page.locator('.backdrop canvas').count()).toBe(1);
    const transform = await page.locator('.backdrop .layer').first().evaluate((el) => getComputedStyle(el).transform);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
  });
});
