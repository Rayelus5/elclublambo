import { fileURLToPath } from 'node:url';

/** Credentials of the e2e admin written by admin.setup.ts (git-ignored). */
export const ADMIN_FILE = fileURLToPath(new URL('./.state/admin.json', import.meta.url));
