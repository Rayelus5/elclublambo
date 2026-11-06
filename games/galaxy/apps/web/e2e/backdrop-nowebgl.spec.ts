import { expect, test } from '@playwright/test';

// Without WebGL (Review Focus 4): the backdrop falls back to 2D dots and the access screen keeps working.
test.use({ launchOptions: { args: ['--disable-webgl', '--disable-webgl2'] } });

test('sin WebGL la galaxia se dibuja en 2D y se puede entrar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/galaxy/entrar');
  expect(await page.evaluate(() => document.createElement('canvas').getContext('webgl2'))).toBeNull();
  await expect(page.locator('.backdrop canvas[data-drawn="2d"]').first()).toBeAttached({ timeout: 20_000 });
  await page.getByLabel('Usuario').fill('alguien');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
