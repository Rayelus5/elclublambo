import { randomBytes } from 'node:crypto';
import { test as base } from '@playwright/test';

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

export { expect, type Page } from '@playwright/test';
