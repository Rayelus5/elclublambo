import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as setup } from '@playwright/test';
import { E2E_ENV } from '../playwright.config';
import { ADMIN_FILE } from './state';

// Runs after the web server is up (projects run after webServer), so dist/cli.js exists.
setup('crear un admin de e2e con el CLI del contenedor', () => {
  const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));
  const name = `e2e_adm_${randomBytes(4).toString('hex')}`;
  const out = execFileSync('node', [cli, 'create-admin', name, '--role', 'admin', '--json'], {
    env: { ...process.env, ...E2E_ENV },
    encoding: 'utf8',
  });
  mkdirSync(fileURLToPath(new URL('./.state/', import.meta.url)), { recursive: true });
  writeFileSync(ADMIN_FILE, out.trim().split('\n').at(-1) ?? '');
});
