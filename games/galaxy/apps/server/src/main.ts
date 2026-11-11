import { buildApp } from './app';
import { createDb } from './db';
import { loadEnv } from './env';
import { startRetention } from './retention';

// Production entry (`node dist/main.js`): env from the container, listen on 0.0.0.0:PORT, close cleanly on SIGTERM
// (docker stop / compose recreate) so in-flight requests finish and the pool is released.
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db });
const stopRetention = startRetention(db, app.log);
// The shop's keys: a code, never the keys (shop and lab plan, F4).
if (env.stripe) app.log.info({ mode: env.stripe.mode }, 'stripe_ready');
else app.log.info({ issue: env.stripeIssue ?? 'stripe_off' }, env.stripeIssue ?? 'stripe_off');

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  stopRetention();
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
