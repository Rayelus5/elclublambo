import { runCli } from '../cli';
import { createDb } from '../db';
import { loadEnv } from '../env';

// Entry of `node dist/cli.js <command> …` inside the container (secrets come from the container env).
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
try {
  process.exitCode = await runCli(process.argv.slice(2), { db, env, out: (s) => console.log(s) });
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
