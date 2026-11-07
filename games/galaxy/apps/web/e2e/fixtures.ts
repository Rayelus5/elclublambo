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

/** After «Crear cuenta» the probe test comes first (GDD §12.2). Skipping it still gives a probe; then home. */
export async function skipProbeTest(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/galaxy\/sonda$/);
  await page.getByRole('button', { name: 'Saltar el test' }).click();
  await page.getByRole('button', { name: 'Descubrir mi sonda' }).click();
  await expect(page.getByText('Tu sonda')).toBeVisible();
  await page.goto('/galaxy/');
}

export { expect, type Page };
