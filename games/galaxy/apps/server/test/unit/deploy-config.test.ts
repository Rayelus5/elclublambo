import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { parse } from 'yaml';

// PRE wiring of the game (GDD §18.1): the tunnel must route /galaxy to the game container BEFORE the catch-all
// pre.elclub.party rule, the container must be hardened like `web`, and the pipeline must build, restart and smoke it.
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const load = (rel: string) => parse(readFileSync(root + rel, 'utf8'));

type Rule = { hostname?: string; path?: string; service: string };

test('el túnel manda /galaxy al contenedor galaxy antes que la regla general de pre.elclub.party', () => {
  const ingress = load('deploy/preprod/cloudflared/config.yml').ingress as Rule[];
  const galaxy = ingress.findIndex((r) => r.hostname === 'pre.elclub.party' && r.path === '^/galaxy(/|$)');
  const catchAll = ingress.findIndex((r) => r.hostname === 'pre.elclub.party' && r.path === undefined);
  expect(galaxy).toBeGreaterThanOrEqual(0);
  expect(ingress[galaxy]!.service).toBe('http://galaxy:8080');
  expect(catchAll).toBeGreaterThan(galaxy);
  expect(ingress[catchAll]!.service).toBe('http://web:3000');
});

test('el túnel manda galaxysurvivor.es y www al contenedor galaxy, sin ruta, justo antes del 404 final', () => {
  const ingress = load('deploy/preprod/cloudflared/config.yml').ingress as Rule[];
  const own = ingress.slice(-3, -1);
  expect(own).toEqual([
    { hostname: 'galaxysurvivor.es', service: 'http://galaxy:8080' },
    { hostname: 'www.galaxysurvivor.es', service: 'http://galaxy:8080' },
  ]);
  expect(ingress.at(-1)).toEqual({ service: 'http_status:404' });
  // After every pre.elclub.party rule: the old host's order does not change.
  const lastPre = ingress.findLastIndex((r) => r.hostname === 'pre.elclub.party');
  expect(ingress.length - 3).toBeGreaterThan(lastPre);
});

test('el dominio propio va en el environment de compose, apagado, y cada clave está en DEPLOY_PRE', () => {
  const g = load('deploy/preprod/docker-compose.yml').services.galaxy;
  // Public values only (never a secret: those live in galaxy.env). The cutover switch stays empty until its own PR.
  expect(g.environment).toEqual({ GALAXY_CANONICAL_ORIGIN: 'https://galaxysurvivor.es', GALAXY_LEGACY_REDIRECT_FROM: '' });
  const guide = readFileSync(root + 'games/galaxy/docs/DEPLOY_PRE.md', 'utf8');
  for (const key of Object.keys(g.environment)) expect(guide, key).toContain(`\`${key}\``);
  expect(guide).toContain('## Dominio propio');
});

test('el servicio galaxy de compose está endurecido y en la red de Supabase', () => {
  const compose = load('deploy/preprod/docker-compose.yml');
  const g = compose.services.galaxy;
  expect(g.build.context).toBe('../../games/galaxy');
  expect(g.env_file).toBe('${GALAXY_ENV_FILE:-/opt/elclub/pre/galaxy.env}');
  expect(g.ports).toEqual(['127.0.0.1:8080:8080']);
  expect(g.networks).toEqual(expect.arrayContaining(['default', 'supabase_default']));
  expect(g.read_only).toBe(true);
  expect(g.tmpfs).toEqual(expect.arrayContaining(['/tmp']));
  expect(g.cap_drop).toEqual(['ALL']);
  expect(g.security_opt).toEqual(expect.arrayContaining(['no-new-privileges:true']));
  expect(g.restart).toBe('unless-stopped');
  expect(compose.services.cloudflared.depends_on).toEqual(expect.arrayContaining(['web', 'galaxy']));
});

test('las migraciones de galaxy no están fechadas en el futuro', () => {
  // `supabase db push` (PRE and production) refuses local migrations older than the newest applied one: a galaxy
  // migration dated ahead would break the deploy of any ElClub migration created before that date but merged later.
  const now = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const galaxy = readdirSync(root + 'supabase/migrations').filter((f) => /_galaxy_/.test(f));
  expect(galaxy.length).toBeGreaterThan(0);
  for (const f of galaxy) expect(f.slice(0, 14) <= now, f).toBe(true);
});

test('la imagen instala las dependencias de producción con el lockfile y la caché de pnpm, sin pnpm deploy', () => {
  // M1 deploy: `pnpm deploy --legacy` re-resolved 91 packages online, ~10 s each from the homelab (17 min).
  const dockerfile = readFileSync(root + 'games/galaxy/Dockerfile', 'utf8');
  expect(dockerfile).not.toMatch(/^RUN [^\n]*pnpm[^\n]* deploy /m);
  expect(dockerfile).toMatch(/pnpm install --prod --frozen-lockfile[^\n]*--filter @galaxy\/server/);
  const pnpmRuns = dockerfile.split('\n').filter((l) => /^RUN .*pnpm install/.test(l));
  expect(pnpmRuns.length).toBeGreaterThanOrEqual(2);
  for (const line of pnpmRuns) expect(line, line).toMatch(/--mount=type=cache/);
});

test('el Dockerfile copia el package.json de cada paquete del workspace (si no, --frozen-lockfile falla en PRE)', () => {
  const dockerfile = readFileSync(root + 'games/galaxy/Dockerfile', 'utf8');
  const galaxy = root + 'games/galaxy/';
  const manifests = ['apps', 'packages'].flatMap((dir) =>
    readdirSync(galaxy + dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${dir}/${d.name}/package.json`)
      .filter((m) => existsSync(galaxy + m)), // pnpm only treats folders with a manifest as workspace projects
  );
  expect(manifests.length).toBeGreaterThan(0);
  for (const m of manifests) {
    const copies = dockerfile.split('\n').filter((l) => l.startsWith('COPY ') && l.includes(m));
    expect(copies.length, m).toBeGreaterThanOrEqual(1); // in the base stage both installs start from
  }
});

// A broken ENV line stops `docker compose build` on PRE, and galaxy-ci never builds the image (landing review, 2026-11-17:
// a literal «\n» instead of a line break). Every ENV instruction, joined over its continuations, is KEY=value pairs.
test('las instrucciones ENV del Dockerfile son pares CLAVE=valor bien partidos', () => {
  const dockerfile = readFileSync(root + 'games/galaxy/Dockerfile', 'utf8');
  const joined = dockerfile.replace(/\\\r?\n\s*/g, ' ');
  const envs = joined.split('\n').filter((l) => l.startsWith('ENV '));
  expect(envs.length).toBeGreaterThan(0);
  for (const line of envs) {
    for (const pair of line.slice(4).trim().split(/\s+/)) expect(pair, line).toMatch(/^[A-Z_][A-Z0-9_]*=[^\s\\]*$/);
  }
  expect(envs.join(' ')).toContain('LANDING_DIST=/app/landing-dist');
});

test('el pipeline de PRE construye, reinicia y comprueba galaxy', () => {
  const steps = load('.github/workflows/preproduction.yml').jobs.deploy.steps as Array<{ name?: string; run?: string }>;
  const run = (name: string) => steps.find((s) => s.name === name)?.run ?? '';
  expect(run('Build')).toMatch(/\$COMPOSE build web galaxy/);
  expect(run('Restart')).toMatch(/up -d --no-build web galaxy cron cloudflared/);
  expect(run('Restart')).not.toMatch(/--force-recreate[^\n]*galaxy/);
  expect(run('Smoke')).toContain('http://127.0.0.1:8080/galaxy/api/health');
  expect(run('Smoke')).toContain('"ok":true');
});
