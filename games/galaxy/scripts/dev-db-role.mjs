// Dev/CI only: lets galaxy_api log in to the LOCAL Supabase Postgres with the password `galaxy_dev`.
// The migration creates galaxy_api NOLOGIN and without a password (no secret in the history); PRE sets its own
// password by hand (games/galaxy/docs/DEPLOY_PRE.md). Refuses any host other than localhost.
import pg from 'pg';

const url = process.env.DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const { hostname } = new URL(url);
if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
  console.error(`dev-db-role: se niega a tocar ${hostname}; solo 127.0.0.1 o localhost`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query("alter role galaxy_api login password 'galaxy_dev'");
  console.log('galaxy_api: contraseña de desarrollo aplicada');
} catch (err) {
  console.error(`dev-db-role: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
