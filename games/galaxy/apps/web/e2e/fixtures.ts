import { randomBytes } from 'node:crypto';
import { expect, type Page, test as base } from '@playwright/test';

// Rate limits live in the database per client IP (registration, login, pulls). Every test gets its own address, so
// a growing suite never trips the limits of the one before it, locally or in CI.
export const test = base.extend<{ freshIp: void }>({
  freshIp: [
    async ({ context }, use) => {
      const b = randomBytes(3);
      await context.setExtraHTTPHeaders({ 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` });
      await use();
    },
    { auto: true },
  ],
});

/** A new account gets the guided tour (polish phase 3); a test about something else leaves it, as a player can. */
export async function skipTutorial(page: Page): Promise<void> {
  const res = await page.request.put('/galaxy/api/tutorial', { data: { action: 'skip' }, headers: { origin: new URL(page.url()).origin } });
  expect(res.status()).toBe(200);
}

/** After «Crear cuenta» the probe test comes first (GDD §12.2). Skipping it still gives a probe; then home. */
export async function skipProbeTest(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/galaxy\/sonda$/);
  await page.getByRole('button', { name: 'Saltar el test' }).click();
  await page.getByRole('button', { name: 'Descubrir mi sonda' }).click();
  await expect(page.getByText('Tu sonda')).toBeVisible();
  await skipTutorial(page);
  await page.goto('/galaxy/');
}

export { expect, type Page };
