import { buildApp } from './app';
import { createDb } from './db';
import { loadEnv } from './env';

// Production entry (`node dist/main.js`): env from the container, listen on 0.0.0.0:PORT, close cleanly on SIGTERM
// (docker stop / compose recreate) so in-flight requests finish and the pool is released.
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db });

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
