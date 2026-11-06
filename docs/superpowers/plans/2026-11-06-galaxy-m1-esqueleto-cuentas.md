# Galaxy Survivor · M1 Esqueleto, cuentas y PRE · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar Galaxy Survivor en `https://pre.elclub.party/galaxy` con:
- un workspace propio;
- cuentas de usuario y contraseña, con TOTP para los admins;
- recuperación por código;
- configuración viva versionada y auditada;
- las pantallas de acceso con el sistema de diseño aprobado;
- su contenedor, túnel, CSP y pipeline.

**Architecture:**
- **Workspace pnpm** independiente en `games/galaxy`, con estos paquetes:

  | Paquete | Contenido |
  |---|---|
  | `packages/shared` | Esquemas Zod y registro de configuración |
  | `apps/server` | Fastify + Kysely sobre Postgres, rol `galaxy_api` |
  | `apps/web` | Vite + React 19 |

- **El servidor:**
  - sirve la API en `/galaxy/api/*` y el build web en `/galaxy/*`;
  - decide todo y guarda sesiones como hash en una cookie `gs_sid`;
  - lee la configuración de `galaxy.game_config_versions`, con caché de 10 s.
- **La base de datos** vive en el esquema `galaxy` del Supabase de PRE. Ese esquema no se expone por PostgREST, y las migraciones van en el historial común de `supabase/migrations`.

**Tech Stack:**
- **Runtime:** Node 22 y pnpm por corepack (`pnpm@12.11.2`, como la raíz). TypeScript ^5.
- **Servidor:** Fastify ^5 (`@fastify/cookie`, `@fastify/static`), Kysely + `pg`, Zod ^4, `@node-rs/argon2`, `otpauth`.
- **Web:** Vite (la versión que pida `@vitejs/plugin-react` ^6), React 19.3.0, React Router ^7, TanStack Query ^5.104.3, Zustand ^5, Tailwind v4 (`@tailwindcss/vite`).
- **Tests:** Vitest ^5.0.4, Testing Library, Playwright ^1.64.1, pgTAP con el CLI de Supabase 2.121.0.

**Spec:** `games/galaxy/docs/GDD.md`: §2, §16.1, §16.3, §17.1, §18.1, §18.2, §18.5 y §19 (M1). Contexto en `games/galaxy/docs/BRIEF.md` §4.

Patrones del repo que se copian:
- **Límites de frecuencia:** `private.rate_limit` en `supabase/migrations/20261019700101_rate_limits.sql`.
- **pgTAP:** con `begin; select plan(n); … rollback;`, como `supabase/tests/p4_01_ip_rate_limits.test.sql`.
- **Endurecimiento del servicio en compose:** el de `web` en `deploy/preprod/docker-compose.yml`.
- **Pipeline:** `.github/workflows/preproduction.yml`.

## Global Constraints

- **Rama:** `feature/galaxy-survivor`, sale de `develop`. Commits en español con formato convencional (`feat(galaxy): …`), y cada uno termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca se hace push directo a `develop`. M1 termina en un PR a `develop` que fusiona el usuario.
- **TDD estricto:** ningún código de producción sin un test que falle antes.
- **Frontend:** se consulta ui-ux-pro-max antes de escribir cualquier CSS o componente.
  - Tokens semánticos: ningún hex suelto en los componentes.
  - Iconos SVG, nunca emojis.
  - Contraste ≥ 4,5:1, foco visible y `prefers-reduced-motion` respetado.
  - Nada de estilos genéricos de IA.
- **Solo escritorio** (GDD §2): se exige puntero fino y al menos 1280×720, y la interfaz se adapta a pantallas anchas. Solo español.
- **Copy:** títulos cortos y directos, sin símbolos especiales (·, :, —, →, //) y sin punto final. Los títulos importantes de cada pantalla se le preguntan al usuario como preguntas de opciones con respuesta libre.
- **Usuario:** `^[a-z0-9_]{3,20}$` sin distinguir mayúsculas. Se normaliza a minúsculas al entrar, y la base guarda solo minúsculas.
- **Contraseña:** de 10 a 128 caracteres y distinta del usuario. Se guarda con argon2id (`@node-rs/argon2`, memoryCost 19456, timeCost 2, parallelism 1).
- **Sesión:**
  - token aleatorio de 32 bytes en base64url; la base guarda solo su `sha256`;
  - cookie `gs_sid` con `HttpOnly; Secure; SameSite=Strict; Path=/galaxy`;
  - jugadores, 30 días; admins, 12 h. Los dos valores salen de la configuración `auth`.
- **Admins:** toda cuenta con rol `superadmin`, `admin` o `moderator` entra en dos pasos: contraseña y después TOTP (SHA1, 6 dígitos, 30 s, ventana ±1, sin reutilizar un paso ya usado). El secreto se guarda cifrado con AES-256-GCM y la clave `GALAXY_TOTP_KEY` (32 bytes en base64).
- **Errores de la API:** `{ "error": <ApiErrorCode> }` con el código HTTP correspondiente. Los mensajes en español viven solo en la web.
- **Rutas:**
  - API en `/galaxy/api/*`;
  - web con `base: '/galaxy/'`;
  - el contenedor escucha en `8080`;
  - health en `GET /galaxy/api/health`.
- **Cabeceras en todas las respuestas:**
  - CSP exacta: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`;
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: same-origin`;
  - `Cross-Origin-Opener-Policy: same-origin`.
- **Esquema `galaxy`:**
  - `anon`, `authenticated` y `service_role` no tienen `usage` sobre él;
  - el rol `galaxy_api` solo tiene los permisos que se le conceden tabla a tabla;
  - nunca se añade a `api.schemas` de `supabase/config.toml`.
- **Base de datos local compartida:** es la del usuario.
  - **Prohibido sin avisarle antes:** `supabase db reset`, `pnpm db:test` y el e2e de la raíz.
  - **Para aplicar migraciones:** `pnpm exec supabase migration up`.
  - **Para pgTAP:** `pnpm exec supabase test db`, que no resetea.
  - **Tests de integración de galaxy:** usan nombres con sufijo aleatorio y solo escriben en el esquema `galaxy`.
- **Entorno Windows:** pnpm sale de corepack. En Git Bash hay que añadir `/c/Windows/System32` al final del PATH antes de Playwright. Nunca se escriben archivos con `Set-Content` ni `Out-File` (BOM).

## Review Focus

Entradas que el GDD implica y que ningún test de las tareas cubre por sí solo; cada una lleva su test en la tarea que la posee:

1. **Mayúsculas o nombre reservado escrito de otra forma.** «Rayelus» o «RAYELUS» se normalizan y respetan la reserva de `rayelus`. Entrar como «SonDa_Rayo» encuentra la cuenta `sonda_rayo` → Tarea 3.
2. **Dos registros simultáneos del mismo nombre.** Uno recibe 201 y el otro 409 `username_taken`, nunca 500 → Tarea 4.
3. **Sesión caducada o revocada**, por ejemplo una cookie vieja tras canjear un código de recuperación. Responde 401 `unauthenticated`, borra la cookie y la web vuelve a «Entrar» sin bucle → Tareas 4 y 9.
4. **Código TOTP reutilizado** dentro de su ventana: se rechaza → Tarea 5.
5. **Mantenimiento activado o registro cerrado.** Los admins siguen entrando y pueden reabrirlo desde la API de configuración → Tarea 6.

---

## Mapa de archivos

```
games/galaxy/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.mjs, vitest.config.ts, .dockerignore, Dockerfile
  scripts/dev-db-role.mjs                  # pone contraseña de desarrollo a galaxy_api en la BD local
  docs/DESIGN_SYSTEM.md                    # Tarea 8
  docs/DEPLOY_PRE.md                       # Tarea 10
  packages/shared/src/
    account.ts                             # usernameSchema, passwordSchema, entradas de auth, Role, MeResponse
    errors.ts                              # ApiErrorCode
    config/registry.ts                     # configSchemas, ConfigKey, ConfigValue, parseConfig
    index.ts
  apps/server/src/
    env.ts  db.ts  db/schema.ts  app.ts  main.ts  cli.ts
    security/headers.ts  security/origin.ts  security/client-ip.ts
    ratelimit.ts  audit.ts  health.ts  static.ts  maintenance.ts
    auth/password.ts  auth/tokens.ts  auth/accounts.ts  auth/sessions.ts  auth/challenges.ts
    auth/totp.ts  auth/guards.ts  auth/routes.ts  auth/recovery.ts
    config/service.ts  config/routes.ts
  apps/server/test/unit/*.test.ts, apps/server/test/integration/*.test.ts, apps/server/test/helpers.ts
  apps/web/ index.html, vite.config.ts, playwright.config.ts, public/fonts/*.woff2
  apps/web/src/ main.tsx, App.tsx, api/client.ts, auth/useMe.ts, copy/es.ts, styles/tokens.css, styles/app.css,
                shell/DesktopGate.tsx, scene/AuthBackdrop.tsx, ui/*.tsx, routes/{Entrar,CrearCuenta,Verificar,Recuperar,Inicio}.tsx
  apps/web/test/*.test.tsx, apps/web/e2e/auth.spec.ts, apps/web/e2e/global-setup.ts
supabase/migrations/20261107100001_galaxy_foundation.sql
supabase/migrations/20261107100002_galaxy_config.sql
supabase/tests/970_galaxy_foundation.test.sql
supabase/tests/971_galaxy_config.test.sql
deploy/preprod/docker-compose.yml        (servicio galaxy)
deploy/preprod/cloudflared/config.yml    (regla /galaxy)
deploy/preprod/galaxy.env.example
.github/workflows/preproduction.yml      (build, restart, smoke de galaxy)
.github/workflows/galaxy-ci.yml
tsconfig.json, eslint.config.mjs, .dockerignore   (excluir games/**)
```

---

### Task 1: Workspace y esquemas compartidos

**Files:**
- Create: `games/galaxy/{package.json,pnpm-workspace.yaml,tsconfig.base.json,eslint.config.mjs,vitest.config.ts}`, `games/galaxy/packages/shared/{package.json,tsconfig.json}`, `games/galaxy/packages/shared/src/{account.ts,errors.ts,config/registry.ts,index.ts}`
- Create: `.github/workflows/galaxy-ci.yml`
- Modify: `tsconfig.json` (añadir `"games"` a `exclude`), `eslint.config.mjs` (añadir `"games/**"` a `globalIgnores`), `.dockerignore` (añadir `games`)
- Test: `games/galaxy/packages/shared/test/account.test.ts`, `games/galaxy/packages/shared/test/registry.test.ts`

**Interfaces:**
- Produces (`@galaxy/shared`):
  - `usernameSchema`: string que se pasa a minúsculas y se valida con `^[a-z0-9_]{3,20}$`.
  - `passwordSchema`: de 10 a 128 caracteres.
  - Entradas de autenticación:
    - `registerInput` y `loginInput` = `{ username, password }`, con «contraseña distinta del usuario» en `registerInput`;
    - `totpInput` = `{ challenge: string; code: /^\d{6}$/ }`;
    - `resetRedeemInput` = `{ username; code: string; newPassword }`.
  - `type Role = 'superadmin' | 'admin' | 'moderator'`.
  - `type MeResponse = { id: string; username: string; roles: Role[]; mfa: boolean }`.
  - `type LoginResponse = { status: 'ok'; me: MeResponse } | { status: 'totp_required'; challenge: string }`.
  - `type ApiErrorCode = 'invalid_input' | 'username_taken' | 'username_reserved' | 'invalid_credentials' | 'rate_limited' | 'banned' | 'invalid_totp' | 'challenge_expired' | 'unauthenticated' | 'forbidden' | 'origin_rejected' | 'registration_closed' | 'maintenance' | 'invalid_reset_code' | 'config_invalid' | 'not_found' | 'internal'`.
  - Configuración:
    - `configSchemas = { features, auth }`, `type ConfigKey = keyof typeof configSchemas`, `type ConfigValue<K>`;
    - `parseConfig<K extends ConfigKey>(key: K, data: unknown): ConfigValue<K>`, que lanza `ZodError`;
    - `features = { registrationOpen: boolean (default true), maintenance: boolean (default false) }`;
    - `auth`: todos enteros con estos rangos y valores por defecto:

      | Campo | Rango | Por defecto |
      |---|---|---|
      | `sessionDays` | 1–90 | 30 |
      | `adminSessionHours` | 1–72 | 12 |
      | `registerPerIpHour` | 1–1000 | 5 |
      | `loginPerIpTenMin` | 1–1000 | 30 |
      | `loginPerUserTenMin` | 1–1000 | 10 |
      | `totpPerAccountTenMin` | 1–1000 | 10 |
      | `resetRedeemPerIpHour` | 1–1000 | 10 |

- [ ] **Step 1: Crear el workspace mínimo**

  - **`pnpm-workspace.yaml`:** `packages: [apps/*, packages/*]`.
  - **`package.json` raíz:**
    - `"private": true`, `"packageManager": "pnpm@12.11.2"`;
    - scripts `test` (`vitest run`), `test:unit` (`vitest run --project unit --project web`), `typecheck` (`pnpm -r typecheck`), `lint` (`eslint .`) y `build` (`pnpm -r build`).
  - **`vitest.config.ts`:** usa `test.projects` con tres proyectos:

    | Proyecto | Entorno | Cubre | Notas |
    |---|---|---|---|
    | `unit` | node | `packages/*/test` y `apps/server/test/unit` | — |
    | `web` | jsdom | `apps/web/test` | Testing Library y `jest-dom` en su `setupFiles` |
    | `integration` | node | `apps/server/test/integration` | `fileParallelism: false` |
  - **`tsconfig.base.json`:** `strict`, `noUncheckedIndexedAccess`, `module: esnext`, `moduleResolution: bundler`, `target: ES2022`.
  - **`eslint.config.mjs`:** `typescript-eslint` recommended más `eslint-plugin-react-hooks` para `apps/web`.
  - **Comprobación:** `pnpm install` dentro de `games/galaxy` crea `games/galaxy/pnpm-lock.yaml` y no toca `pnpm-lock.yaml` de la raíz.

- [ ] **Step 2: Escribir los tests que fallan**

```ts
// packages/shared/test/account.test.ts
test('normaliza a minúsculas y acepta el patrón', () => {
  expect(usernameSchema.parse('SonDa_Rayo')).toBe('sonda_rayo');
});
test.each(['ab', 'a'.repeat(21), 'con espacio', 'ñandú', 'guion-medio'])('rechaza %s', (u) => {
  expect(usernameSchema.safeParse(u).success).toBe(false);
});
test('contraseña de 10 a 128', () => {
  expect(passwordSchema.safeParse('123456789').success).toBe(false);
  expect(passwordSchema.safeParse('1234567890').success).toBe(true);
  expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
});
test('registerInput rechaza contraseña igual al usuario sin distinguir mayúsculas', () => {
  expect(registerInput.safeParse({ username: 'Piloto_01', password: 'piloto_01' }).success).toBe(false);
});
test('totpInput exige 6 dígitos', () => {
  expect(totpInput.safeParse({ challenge: 'x', code: '12345' }).success).toBe(false);
});
// packages/shared/test/registry.test.ts
test('features y auth tienen valores por defecto', () => {
  expect(parseConfig('features', {})).toEqual({ registrationOpen: true, maintenance: false });
  expect(parseConfig('auth', {}).sessionDays).toBe(30);
});
test('auth rechaza valores fuera de rango', () => {
  expect(() => parseConfig('auth', { sessionDays: 0 })).toThrow();
  expect(() => parseConfig('auth', { adminSessionHours: 73 })).toThrow();
});
```

- [ ] **Step 3: Ejecutar y ver que fallan**

  Run: `pnpm -C games/galaxy test:unit`
  Expected: FAIL, porque no existen los módulos.

- [ ] **Step 4: Implementar `account.ts`, `errors.ts`, `config/registry.ts` e `index.ts`**

  Los esquemas usan `.default()` de Zod para que `parseConfig(key, {})` devuelva los valores por defecto.

- [ ] **Step 5: Ejecutar y ver que pasan**

  Run: `pnpm -C games/galaxy test:unit && pnpm -C games/galaxy typecheck && pnpm -C games/galaxy lint`
  Expected: PASS.

- [ ] **Step 6: Excluir `games/**` de la raíz y comprobarlo**

  Run: `pnpm typecheck && pnpm lint` en la raíz.
  Expected: PASS, sin errores procedentes de `games/`.

- [ ] **Step 7: Crear `.github/workflows/galaxy-ci.yml`**

  - **Disparadores:**
    - `pull_request` y `push` con `paths`: `games/**`, `supabase/migrations/*_galaxy_*.sql`, `supabase/tests/97*_galaxy_*.test.sql` y el propio workflow;
    - además, `workflow_dispatch`.
  - **Runner:** `ubuntu-latest`, nunca el self-hosted, con `permissions: contents: read`.
  - **Pasos:**
    1. `actions/checkout@v4`.
    2. `supabase/setup-cli@v1` con versión `2.121.0`.
    3. `supabase db start`.
    4. `node games/galaxy/scripts/dev-db-role.mjs`. Este script se crea en la Tarea 2; hasta entonces el paso se ejecuta con `if: hashFiles('games/galaxy/scripts/dev-db-role.mjs') != ''`.
    5. `corepack enable`.
    6. `pnpm -C games/galaxy install --frozen-lockfile`.
    7. `pnpm -C games/galaxy typecheck`, `lint` y `test`.
    8. `supabase test db`.
  - El e2e se añade a este workflow en la Tarea 9.

- [ ] **Step 8: Commit**

```bash
git add games/galaxy tsconfig.json eslint.config.mjs .dockerignore .github/workflows/galaxy-ci.yml
git commit -m "feat(galaxy): workspace propio, esquemas compartidos y CI"
```

---

### Task 2: Migración base del esquema `galaxy`

**Files:**
- Create: `supabase/migrations/20261107100001_galaxy_foundation.sql`, `games/galaxy/scripts/dev-db-role.mjs`
- Test: `supabase/tests/970_galaxy_foundation.test.sql`

**Interfaces:**
- **Produces, rol:** `galaxy_api` se crea con `nologin` dentro de un bloque `DO … if not exists`, porque los roles sobreviven a `db reset`. La contraseña nunca va en la migración.
- **Produces, tablas:** todas en `galaxy`, todas con RLS activado y sin políticas. `galaxy_api` es dueño de nada.

  | Tabla | Columnas | Permisos de `galaxy_api` |
  |---|---|---|
  | `accounts` | `id uuid pk default gen_random_uuid()`, `username text unique not null check (username ~ '^[a-z0-9_]{3,20}$')`, `password_hash text not null`, `created_at timestamptz default now()`, `banned_until timestamptz`, `ban_reason text` | select, insert, update |
  | `account_roles` | `account_id uuid references accounts on delete cascade`, `role text check (role in ('superadmin','admin','moderator'))`, pk `(account_id, role)` | select, insert, delete |
  | `reserved_usernames` | `username text pk` | select |
  | `sessions` | `id uuid pk`, `account_id uuid fk`, `token_hash bytea unique not null`, `mfa boolean not null default false`, `created_at`, `expires_at timestamptz not null`, `last_seen_at`, `ip inet`, `user_agent text` | select, insert, update, delete |
  | `login_challenges` | `id`, `account_id`, `token_hash bytea unique`, `expires_at`, `used_at` | select, insert, update |
  | `admin_totp` | `account_id uuid pk fk`, `secret_enc bytea not null`, `last_used_step bigint not null default 0`, `created_at` | select, insert, update |
  | `reset_codes` | `id`, `account_id fk`, `code_hash bytea unique`, `created_at`, `expires_at`, `used_at`, `created_by uuid null` | select, insert, update |
  | `rate_limit_hits` | `subject text`, `bucket text`, `window_start timestamptz`, `hits int`, pk `(subject, bucket, window_start)` | ninguno directo |
  | `admin_audit_log` | `id bigserial pk`, `at timestamptz default now()`, `actor_id uuid null`, `actor_label text not null`, `action text not null`, `target_type text`, `target_id text`, `before jsonb`, `after jsonb`, `reason text not null`, `ip inet` | select, insert |

  `reserved_usernames` se rellena con: `rayelus admin administrador moderador moderator perkins ecn galaxy sistema system soporte support root staff`.

- **Produces, función:** `galaxy.rate_limit(p_subject text, p_bucket text, p_max int, p_window interval) returns void`. Copia la mecánica de `private.rate_limit`: `date_bin`, borrar filas viejas y lanzar `raise exception 'rate_limited'` al pasar el máximo. Es `security definer` con `set search_path = ''`, y solo `galaxy_api` tiene `execute`; se revoca de `public`.
- **Produces, auditoría de solo añadir:** el trigger `galaxy.forbid_audit_mutation()` está en `before update or delete` sobre `admin_audit_log` y lanza `'audit_log_is_append_only'`.
- **Produces, permisos:**
  - `revoke all on schema galaxy from public, anon, authenticated, service_role`;
  - `grant usage on schema galaxy to galaxy_api`;
  - `grant usage on all sequences` a `galaxy_api`.
- **Produces, script `dev-db-role.mjs`:**
  - Con `pg` y `DATABASE_ADMIN_URL`, que por defecto es `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, ejecuta `alter role galaxy_api login password 'galaxy_dev'`.
  - Se niega si el host no es `127.0.0.1` ni `localhost`.

- [ ] **Step 1: Escribir el test pgTAP que falla** (`970_galaxy_foundation.test.sql`, con `begin; select plan(N); … select * from finish(); rollback;`). Comprobaciones:

  - `has_schema('galaxy')` y las 9 tablas con `has_table`.
  - Ningún rol de API ve el esquema:

    ```sql
    select ok(not has_schema_privilege('anon','galaxy','usage') and not has_schema_privilege('authenticated','galaxy','usage') and not has_schema_privilege('service_role','galaxy','usage'), 'ningún rol de la API ve galaxy');
    ```

  - `has_schema_privilege('galaxy_api','galaxy','usage')`.
  - `galaxy_api` no lee el foro: `not has_table_privilege('galaxy_api','public.members','select')`.
  - `galaxy_api` no puede actualizar `admin_audit_log`: `not has_table_privilege('galaxy_api','galaxy.admin_audit_log','update')`.
  - Un `update` sobre `admin_audit_log` como `postgres` lanza `'audit_log_is_append_only'`, comprobado con `throws_ok`.
  - Usuarios inválidos: `throws_ok` al insertar `'Rayelus'` (mayúsculas) y `'ab'` en `accounts` (violación del check, `23514`).
  - Límite de frecuencia: `galaxy.rate_limit('ip:x','t',2,'1 minute')` vive dos veces y la tercera lanza `rate_limited`.
  - `exists (select 1 from galaxy.reserved_usernames where username = 'rayelus')`.

- [ ] **Step 2: Ejecutar y ver que falla**

  Run: `pnpm exec supabase test db` desde la raíz.
  Expected: FAIL en `970_galaxy_foundation`: el esquema no existe.

- [ ] **Step 3: Escribir la migración** `20261107100001_galaxy_foundation.sql`, con las tablas, el trigger, la función y los permisos de arriba. Arriba lleva un comentario de cabecera con su propósito, como las demás migraciones.

- [ ] **Step 4: Aplicar y verificar**

  Run: `pnpm exec supabase migration up && pnpm exec supabase test db`
  Expected: `970_galaxy_foundation` pasa, y los tests existentes siguen en verde.

- [ ] **Step 5: Escribir y ejecutar `dev-db-role.mjs`**

  Run: `node games/galaxy/scripts/dev-db-role.mjs`
  Expected: imprime `galaxy_api: contraseña de desarrollo aplicada`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261107100001_galaxy_foundation.sql supabase/tests/970_galaxy_foundation.test.sql games/galaxy/scripts/dev-db-role.mjs
git commit -m "feat(galaxy): esquema galaxy, rol galaxy_api, cuentas, sesiones y auditoría"
```

---

### Task 3: Servidor base, cabeceras, origen, IP, límites y cuentas

**Files:**
- Create: `apps/server/{package.json,tsconfig.json}`, `src/{env.ts,db.ts,db/schema.ts,app.ts,health.ts,ratelimit.ts}`, `src/security/{headers.ts,origin.ts,client-ip.ts}`, `src/auth/{password.ts,tokens.ts,accounts.ts}`, `test/helpers.ts`
- Test: `test/unit/{headers,origin,client-ip,password,tokens}.test.ts`, `test/integration/{health,accounts}.test.ts`

**Interfaces:**
- Consumes:
  - `@galaxy/shared`: `usernameSchema`, `passwordSchema`, `ApiErrorCode`.
  - De la Tarea 2: tablas y `galaxy.rate_limit`.
- Produces:
  - `loadEnv(src = process.env): Env`, donde `Env` es:

    | Variable | Tipo | Por defecto |
    |---|---|---|
    | `DATABASE_URL` | string | — |
    | `GALAXY_PUBLIC_ORIGINS` | string[], separado por comas | — |
    | `GALAXY_TOTP_KEY` | Buffer de 32 bytes | — |
    | `PORT` | number | 8080 |
    | `WEB_DIST` | string | `/app/web-dist` |
    | `TRUST_CF_IP` | boolean | true |

  - `createDb(url: string): Kysely<DB>` y `interface DB` en `db/schema.ts`, con una interfaz por tabla de la Tarea 2.
  - `buildApp(deps: { env: Env; db: Kysely<DB>; now?: () => Date }): Promise<FastifyInstance>`, que registra `@fastify/cookie`, las cabeceras, el origen y el health.
  - `CSP: string` y `SECURITY_HEADERS: Record<string, string>`, con los valores exactos de las Global Constraints.
  - `isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean`. El hook `onRequest` responde 403 `origin_rejected` a `POST`, `PUT`, `PATCH` y `DELETE` sin un Origin permitido.
  - `clientIp(req: FastifyRequest, trustCf: boolean): string`. Devuelve `CF-Connecting-IP` si es una IP válida (`net.isIP`) y `trustCf`; si no, `req.socket.remoteAddress ?? 'unknown'`.
  - `hitRateLimit(db, subject: string, bucket: string, max: number, windowSeconds: number): Promise<void>`. Llama a `galaxy.rate_limit` y lanza `RateLimitedError` si la BD responde `rate_limited`.
  - `hashPassword(pw: string): Promise<string>` y `verifyPassword(hash: string, pw: string): Promise<boolean>`.
  - `DUMMY_HASH: string`: un hash precalculado que se verifica cuando el usuario no existe, para que la respuesta tarde lo mismo.
  - `newToken(): { token: string; hash: Buffer }` y `hashToken(token: string): Buffer`, con sha256.
  - `registerAccount(db, input: { username: string; password: string }, opts?: { allowReserved?: boolean }): Promise<{ id: string }>`. Lanza `UsernameTakenError` (también ante el `23505` de una carrera) o `UsernameReservedError`.
  - `findAccountByUsername(db, username: string): Promise<AccountRow | undefined>`. Normaliza el nombre.
  - `test/helpers.ts`: `testEnv(): Env`, con `DATABASE_URL = process.env.GALAXY_TEST_DATABASE_URL ?? 'postgresql://galaxy_api:galaxy_dev@127.0.0.1:54322/postgres'`, orígenes `http://localhost:5173` y `http://localhost:8080`, y una clave TOTP fija de test. También `uniqueName(prefix: string): string` y `testApp(): Promise<{ app; db; close }>`.

- [ ] **Step 1: Escribir los tests unitarios que fallan**

```ts
test('CSP exacta', () => expect(CSP).toBe("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"));
test('origen', () => {
  expect(isAllowedOrigin('https://pre.elclub.party', ['https://pre.elclub.party'])).toBe(true);
  expect(isAllowedOrigin(undefined, ['https://pre.elclub.party'])).toBe(false);
  expect(isAllowedOrigin('https://pre.elclub.party.evil.com', ['https://pre.elclub.party'])).toBe(false);
});
test('IP: usa CF-Connecting-IP válida y cae al socket si falta o es basura', () => {
  expect(clientIp(fakeReq({ 'cf-connecting-ip': '203.0.113.7' }, '10.0.0.2'), true)).toBe('203.0.113.7');
  expect(clientIp(fakeReq({}, '10.0.0.2'), true)).toBe('10.0.0.2');
  expect(clientIp(fakeReq({ 'cf-connecting-ip': 'no-ip' }, '10.0.0.2'), true)).toBe('10.0.0.2');
});
test('argon2id', async () => {
  const h = await hashPassword('correcto-caballo');
  expect(h.startsWith('$argon2id$')).toBe(true);
  expect(await verifyPassword(h, 'correcto-caballo')).toBe(true);
  expect(await verifyPassword(h, 'otro-caballo')).toBe(false);
});
test('token de 32 bytes y hash sha256', () => {
  const { token, hash } = newToken();
  expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  expect(hashToken(token).equals(hash)).toBe(true);
});
```

- [ ] **Step 2: Escribir los tests de integración que fallan**

```ts
test('health responde ok con BD y lleva las cabeceras', async () => {
  const res = await app.inject({ method: 'GET', url: '/galaxy/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true, db: 'up' });
  expect(res.headers['content-security-policy']).toBe(CSP);
  expect(res.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
});
test('POST sin Origin permitido → 403 origin_rejected', async () => {
  // ruta POST de prueba registrada en el test antes de app.ready(): app.post('/galaxy/api/_test', () => ({ ok: true }))
  const res = await app.inject({ method: 'POST', url: '/galaxy/api/_test', headers: { origin: 'https://evil.example' } });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toEqual({ error: 'origin_rejected' });
});
test('registro normaliza y respeta reservados (Review Focus 1)', async () => {
  await expect(registerAccount(db, { username: 'RAYELUS', password: 'una-clave-larga' })).rejects.toBeInstanceOf(UsernameReservedError);
  const name = uniqueName('SonDa');
  await registerAccount(db, { username: name, password: 'una-clave-larga' });
  expect((await findAccountByUsername(db, name.toUpperCase()))?.username).toBe(name.toLowerCase());
});
test('nombre repetido → UsernameTakenError', async () => {
  const name = uniqueName('dup');
  await registerAccount(db, { username: name, password: 'una-clave-larga' });
  await expect(registerAccount(db, { username: name, password: 'una-clave-larga' })).rejects.toBeInstanceOf(UsernameTakenError);
});
test('allowReserved permite crear rayelus solo con la opción', async () => { /* dentro de una transacción que se revierte */ });
test('hitRateLimit lanza RateLimitedError al pasar el máximo', async () => {
  const s = uniqueName('ip');
  await hitRateLimit(db, s, 't', 1, 60);
  await expect(hitRateLimit(db, s, 't', 1, 60)).rejects.toBeInstanceOf(RateLimitedError);
});
```

  Health devuelve 503 `{ ok: false, db: 'down' }` si `select 1` falla. Se prueba con un `Kysely` apuntando a un puerto cerrado.

- [ ] **Step 3: Ejecutar y ver que fallan**

  Run: `pnpm -C games/galaxy test`
  Expected: FAIL, porque no existen los módulos.

- [ ] **Step 4: Implementar los módulos con las firmas de Interfaces**

  - **Errores:** `app.ts` registra un `setErrorHandler` que traduce `ZodError` a 400 `invalid_input`, `RateLimitedError` a 429 `rate_limited` y el resto a 500 `internal`.
  - **Logs:** nunca registran contraseñas ni tokens, solo códigos.

- [ ] **Step 5: Ejecutar y ver que pasan**

  Run: `pnpm -C games/galaxy test && pnpm -C games/galaxy typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add games/galaxy/apps/server
git commit -m "feat(galaxy): servidor Fastify con cabeceras, origen, IP, límites y cuentas"
```

---

### Task 4: Sesiones y rutas de registro, entrada, salida y perfil

**Files:**
- Create: `apps/server/src/auth/{sessions.ts,guards.ts,routes.ts}`
- Test: `apps/server/test/integration/auth-routes.test.ts`

**Interfaces:**
- Consumes:
  - Tarea 3: `registerAccount`, `findAccountByUsername`, `verifyPassword`, `DUMMY_HASH`, `newToken`, `hashToken`, `hitRateLimit`, `clientIp`.
  - `parseConfig('auth')`. Hasta la Tarea 6, los valores se leen de `configSchemas.auth.parse({})`; la Tarea 6 los cambia por el servicio de configuración.
- Produces:
  - `createSession(db, accountId: string, opts: { ip: string; userAgent: string; mfa: boolean; ttlMs: number }): Promise<string>`, que devuelve el token.
  - `readSession(db, token: string, now: Date): Promise<SessionInfo | null>`, donde `SessionInfo = { sessionId: string; accountId: string; username: string; roles: Role[]; mfa: boolean }`. Actualiza `last_seen_at` como mucho cada 5 minutos.
  - `revokeSession(db, token: string): Promise<void>` y `revokeAllSessions(db, accountId: string): Promise<void>`.
  - `requireSession(req): SessionInfo`, que lanza 401 `unauthenticated` y borra la cookie, y `requireAdmin(req): SessionInfo`, que exige un rol `admin` o `superadmin` y `mfa = true`, o lanza 403 `forbidden`. Un `preHandler` decora `req.session` leyendo la cookie `gs_sid`.
  - `setSessionCookie(reply, token, maxAgeSec)` y `clearSessionCookie(reply)`, con los atributos exactos de las Global Constraints.
  - Rutas:

    | Ruta | Éxito | Errores |
    |---|---|---|
    | `POST /galaxy/api/auth/register` | 201 con `MeResponse`; crea la sesión y pone la cookie | 409 `username_taken`, 409 `username_reserved`, 400 `invalid_input`, 429 |
    | `POST /galaxy/api/auth/login` | 200 con `LoginResponse` | 401 `invalid_credentials`, 403 `banned`, 429 |
    | `POST /galaxy/api/auth/logout` | 204; revoca la sesión y borra la cookie | — |
    | `GET /galaxy/api/auth/me` | 200 con `MeResponse` | 401 `unauthenticated` |

    - En `register`, el límite es `registerPerIpHour` por IP con el bucket `register`.
    - En `login`, los límites son `loginPerIpTenMin` por IP y `loginPerUserTenMin` por usuario normalizado.
    - Si el usuario no existe, `login` verifica `DUMMY_HASH` antes de responder. Las cuentas baneadas tienen `banned_until > now`.
    - Las cuentas con algún rol devuelven `{ status: 'totp_required', challenge }`. La Tarea 5 implementa el desafío; hasta entonces, un test pendiente marca el caso.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test('registro → cookie gs_sid con atributos exactos y /me', async () => {
  const res = await post('/galaxy/api/auth/register', { username: uniqueName('Nueva'), password: 'una-clave-larga' });
  expect(res.statusCode).toBe(201);
  const c = res.cookies.find((k) => k.name === 'gs_sid')!;
  expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/galaxy' });
  expect(c.maxAge).toBe(30 * 24 * 3600);
  const me = await get('/galaxy/api/auth/me', c.value);
  expect(me.json()).toMatchObject({ roles: [], mfa: false });
});
test('dos registros simultáneos del mismo nombre → 201 y 409 (Review Focus 2)', async () => {
  const name = uniqueName('carrera');
  const [a, b] = await Promise.all([post(REG, { username: name, password: 'una-clave-larga' }), post(REG, { username: name, password: 'una-clave-larga' })]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
});
test('login con mayúsculas funciona; contraseña mala → 401 invalid_credentials', async () => { /* … */ });
test('usuario inexistente → 401 invalid_credentials (mismo código que contraseña mala)', async () => { /* … */ });
test('cuenta baneada → 403 banned', async () => { /* banned_until = now() + 1 day por SQL de test */ });
test('el 11.º login fallido del mismo usuario en 10 min → 429 rate_limited', async () => { /* … */ });
test('logout revoca: la cookie vieja da 401 y Set-Cookie la borra (Review Focus 3)', async () => {
  // … tras logout:
  const me = await get('/galaxy/api/auth/me', oldToken);
  expect(me.statusCode).toBe(401);
  expect(me.json()).toEqual({ error: 'unauthenticated' });
  expect(me.cookies.find((k) => k.name === 'gs_sid')?.maxAge).toBe(0);
});
test('sesión caducada → 401', async () => { /* expires_at en el pasado por SQL de test */ });
```

- [ ] **Step 2: Ejecutar y ver que fallan**

  Run: `pnpm -C games/galaxy test -- auth-routes`
  Expected: FAIL.

- [ ] **Step 3: Implementar `sessions.ts`, `guards.ts` y `routes.ts`**

  La violación de unicidad `23505` en `accounts.username` se traduce a 409 `username_taken`.

- [ ] **Step 4: Ejecutar y ver que pasan**

  Run: `pnpm -C games/galaxy test`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/galaxy/apps/server
git commit -m "feat(galaxy): sesiones con cookie gs_sid y rutas de registro, entrada, salida y perfil"
```

---

### Task 5: TOTP de admins, recuperación por código y CLI

**Files:**
- Create: `apps/server/src/auth/{totp.ts,challenges.ts,recovery.ts}`, `apps/server/src/{audit.ts,cli.ts}`
- Modify: `apps/server/src/auth/routes.ts`
- Test: `test/unit/totp-crypto.test.ts`, `test/integration/{totp,recovery,cli}.test.ts`

**Interfaces:**
- Consumes: Tarea 4: `createSession`, `revokeAllSessions`, `setSessionCookie`, `requireSession`; Tarea 3: `registerAccount` con `allowReserved`, `hashPassword`.
- Produces:
  - **Cifrado del secreto:**
    - `encryptSecret(key: Buffer, base32: string): Buffer`, en formato `iv(12) | tag(16) | ciphertext`;
    - `decryptSecret(key: Buffer, blob: Buffer): string`.
  - **Secretos TOTP:**
    - `newTotpSecret(): { base32: string; uri(username: string): string }`, con emisor `Galaxy Survivor`;
    - `verifyTotp(db, key, accountId, code, now): Promise<boolean>`.
    - `verifyTotp` acepta una ventana de ±1. Solo acepta un paso mayor que `last_used_step`, que actualiza en la misma sentencia.
  - **Desafíos:** `createChallenge(db, accountId: string, ttlMs = 300_000): Promise<string>` y `consumeChallenge(db, token: string, now: Date): Promise<string | null>`. `consumeChallenge` marca `used_at` y devuelve el `accountId`.
  - **`POST /galaxy/api/auth/totp`** recibe `totpInput`:
    - con éxito, devuelve 200 con `MeResponse` y una sesión `mfa = true` de `adminSessionHours`;
    - con un código malo, 401 `invalid_totp`;
    - con un desafío caducado o usado, 401 `challenge_expired`;
    - lleva un límite de `totpPerAccountTenMin`.
  - **`login`** ahora devuelve `{ status: 'totp_required', challenge }` a cuentas con rol.
  - **Auditoría:**
    - `type AuditActor = { id: string | null; label: string; ip?: string }`;
    - `writeAudit(trx, e: { actor: AuditActor; action: string; targetType?: string; targetId?: string; before?: unknown; after?: unknown; reason: string }): Promise<void>`.
  - **Códigos de recuperación:**
    - `issueResetCode(db, username: string, actor: AuditActor): Promise<string>`. El código tiene el formato `XXXX-XXXX-XXXX-XXXX` (base32 sin `I L O U`, 80 bits), caduca en 24 h y se guarda como sha256 en mayúsculas sin guiones. Se audita como `account.reset_code_issued`.
    - `redeemResetCode(db, input: { username; code; newPassword }, now): Promise<void>`. Cambia el hash, revoca todas las sesiones y marca `used_at`; un código malo lanza `InvalidResetCodeError`.
    - Ruta `POST /galaxy/api/auth/reset/redeem`: 204, o 400 `invalid_reset_code`, con un límite de `resetRedeemPerIpHour`.
  - **CLI:** `runCli(argv: string[], deps: { db; env; out: (s: string) => void }): Promise<number>`.
    - `create-admin <usuario> [--role superadmin|admin|moderator] [--json]` crea la cuenta con `allowReserved`, una contraseña aleatoria de 20 caracteres, el rol y TOTP.
    - Imprime el usuario, la contraseña, el secreto base32 y la URI `otpauth://`, o un JSON con `{ username, password, totpSecret, totpUri }`. Lo audita con el actor `{ id: null, label: 'cli' }`.
    - `issue-reset-code <usuario>` imprime el código.
    - Devuelve 0 si va bien y 1 con un mensaje si hay error de uso.
    - En el build, `dist/cli.js` lo ejecuta con `process.argv.slice(2)`.
  - **Ayudantes en `test/helpers.ts`:**
    - `createAdminViaCli(role: Role): Promise<{ username: string; password: string; totpSecret: string }>` llama a `runCli` con `--json` y un nombre de `uniqueName('adm')`;
    - `totpNow(base32: string, at?: Date): string` calcula el código con `otpauth`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test('cifrado ida y vuelta; con otra clave falla', () => {
  const k = randomBytes(32), blob = encryptSecret(k, 'JBSWY3DPEHPK3PXP');
  expect(decryptSecret(k, blob)).toBe('JBSWY3DPEHPK3PXP');
  expect(() => decryptSecret(randomBytes(32), blob)).toThrow();
});
test('admin: login → totp_required; código correcto → sesión mfa de 12 h', async () => {
  const { username, password, totpSecret } = await createAdminViaCli('admin');
  const login = await post('/galaxy/api/auth/login', { username, password });
  expect(login.json().status).toBe('totp_required');
  const res = await post('/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ mfa: true, roles: ['admin'] });
  expect(res.cookies.find((c) => c.name === 'gs_sid')!.maxAge).toBe(12 * 3600);
});
test('el mismo código no vale dos veces (Review Focus 4)', async () => {
  // dos logins seguidos, mismo código en la misma ventana → el segundo 401 invalid_totp
});
test('desafío caducado → 401 challenge_expired', async () => { /* now() + 6 min */ });
test('recuperación: canjear cambia la contraseña y revoca sesiones viejas (Review Focus 3)', async () => {
  // registrar, guardar cookie, issueResetCode, redeem → cookie vieja 401, login con la nueva 200
});
test('código usado o caducado → 400 invalid_reset_code', async () => { /* … */ });
test('create-admin rayelus: crea superadmin con TOTP y deja auditoría', async () => {
  // dentro de transacción revertida o con limpieza de rayelus al final: el test nunca deja a rayelus creado
  expect(code).toBe(0);
  expect(auditRows.at(-1)).toMatchObject({ actor_label: 'cli', action: 'account.admin_created' });
});
test('create-admin con nombre inválido → código 1 y mensaje de uso', async () => { /* … */ });
```

- [ ] **Step 2: Ejecutar y ver que fallan**

  Run: `pnpm -C games/galaxy test -- totp recovery cli`
  Expected: FAIL.

- [ ] **Step 3: Implementar con las firmas de Interfaces**

  `otpauth` se encarga del cálculo TOTP. El paso usado es `Math.floor(epoch / 30) + delta`.

- [ ] **Step 4: Ejecutar y ver que pasan**

  Run: `pnpm -C games/galaxy test`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/galaxy/apps/server
git commit -m "feat(galaxy): TOTP para admins, códigos de recuperación y CLI create-admin"
```

---

### Task 6: Configuración viva versionada y auditada

**Files:**
- Create: `supabase/migrations/20261107100002_galaxy_config.sql`, `apps/server/src/config/{service.ts,routes.ts}`, `apps/server/src/maintenance.ts`
- Modify: `apps/server/src/auth/routes.ts`, que pasa a leer `auth` y `features` del servicio
- Test: `supabase/tests/971_galaxy_config.test.sql`, `apps/server/test/integration/config.test.ts`

**Interfaces:**
- Consumes: `configSchemas`, `parseConfig` y `ConfigKey` de la Tarea 1; `writeAudit` y `requireAdmin` de las Tareas 4 y 5.
- **Produces, en SQL:**
  - Tabla `galaxy.game_config_versions`: `id bigserial pk`, `key text not null`, `version int not null`, `data jsonb not null`, `created_at timestamptz default now()`, `created_by uuid null`, `note text not null`, `unique (key, version)`.
  - Trigger de solo añadir con el error `'config_is_append_only'`. `galaxy_api` tiene `select` e `insert`.
  - Vista `galaxy.game_config_active`, con la última versión de cada clave.
  - La migración siembra la versión 1 de `features` (`{"registrationOpen": true, "maintenance": false}`) y de `auth` (los valores por defecto de la Tarea 1), con `note = 'versión inicial'`.
- **Produces, el servicio:** `createConfigService(db, opts?: { ttlMs?: number; now?: () => number })` devuelve:
  - `get<K extends ConfigKey>(key: K): Promise<ConfigValue<K>>`, con caché de 10 s. Si la fila guardada no pasa `parseConfig`, registra un error y usa los valores por defecto.
  - `versions(key: ConfigKey): Promise<Array<{ version: number; data: unknown; createdAt: string; createdBy: string | null; note: string }>>`.
  - `publish<K extends ConfigKey>(key: K, data: unknown, actor: AuditActor, reason: string): Promise<{ version: number }>`:
    - valida con `parseConfig`;
    - en una sola transacción inserta `version + 1` y la auditoría `config.published` con el antes y el después;
    - invalida la caché.
- **Produces, las rutas de admin** (todas con `requireAdmin`):

  | Ruta | Éxito | Errores |
  |---|---|---|
  | `GET /galaxy/api/admin/config` | `{ key, version, data }[]` | — |
  | `GET /galaxy/api/admin/config/:key/versions` | historial de la clave | — |
  | `POST /galaxy/api/admin/config/:key` con `{ data, reason }` | 201 `{ version }` | 400 `config_invalid`, 404 `not_found` |

  En `POST`, `reason` debe tener al menos 3 caracteres.
- **Produces, el hook de mantenimiento** (`maintenance.ts`):
  - Si `features.maintenance` está activo y la petición no es de un admin, responde 503 `{ error: 'maintenance' }`.
  - Deja pasar health, `login`, `totp`, `me` y `logout`.
- **Registro cerrado:** si `features.registrationOpen` es falso, `register` responde 403 `registration_closed`.

- [ ] **Step 1: Escribir el pgTAP que falla** (`971_galaxy_config.test.sql`):

  - la tabla y la vista existen;
  - `galaxy_api` puede hacer `insert` y no `update`;
  - un `update` lanza `config_is_append_only`;
  - la vista devuelve la versión 1 de `features` y de `auth`;
  - tras insertar la versión 2 de `features`, la vista devuelve la 2.

- [ ] **Step 2: Escribir los tests de integración que fallan**

```ts
test('la siembra pasa los esquemas Zod', async () => {
  expect(await config.get('features')).toEqual({ registrationOpen: true, maintenance: false });
  expect((await config.get('auth')).sessionDays).toBe(30);
});
test('publicar valida, versiona y audita en la misma transacción', async () => {
  await expect(config.publish('auth', { sessionDays: 0 }, actor, 'prueba')).rejects.toThrow();
  const { version } = await config.publish('auth', { sessionDays: 31 }, actor, 'prueba');
  expect((await config.versions('auth')).at(-1)?.version).toBe(version);
  expect(lastAudit()).toMatchObject({ action: 'config.published', target_id: 'auth' });
});
test('las rutas de admin exigen admin con mfa: jugador 403, sin sesión 401', async () => { /* … */ });
test('mantenimiento: jugador 503, admin sigue entrando y lo apaga (Review Focus 5)', async () => {
  // admin publica features.maintenance = true → jugador GET /auth/me OK pero POST /auth/register 503 maintenance
  // admin hace login + totp (permitidos) → POST /admin/config/features { maintenance: false } → 201
});
test('registro cerrado → 403 registration_closed', async () => { /* … */ });
test('la caché caduca a los 10 s', async () => { /* con now inyectado */ });
```

  Cada test que cambia la configuración vuelve a publicar los valores originales en un `afterEach`, para que la BD local del usuario quede como estaba.

- [ ] **Step 3: Ejecutar y ver que fallan**

  Run: `pnpm exec supabase test db` y `pnpm -C games/galaxy test -- config`
  Expected: FAIL.

- [ ] **Step 4: Escribir la migración, aplicarla e implementar el servicio, las rutas y el hook**

  Run: `pnpm exec supabase migration up`

- [ ] **Step 5: Ejecutar y ver que pasan**

  Run: `pnpm exec supabase test db && pnpm -C games/galaxy test`
  Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261107100002_galaxy_config.sql supabase/tests/971_galaxy_config.test.sql games/galaxy/apps/server
git commit -m "feat(galaxy): configuración viva versionada, auditada y con mantenimiento"
```

---

### Task 7: Servir la web y arranque de producción

**Files:**
- Create: `apps/server/src/{static.ts,main.ts}`
- Test: `apps/server/test/integration/static.test.ts`

**Interfaces:**
- Consumes: `buildApp` (Tarea 3), `Env.WEB_DIST`.
- Produces:
  - **`registerStatic(app, webDist: string)`:**
    - sirve `webDist` bajo `/galaxy/`, con `Cache-Control: public, max-age=31536000, immutable` para `/galaxy/assets/*` y `no-cache` para `index.html`;
    - **fallback de SPA:** cualquier `GET` bajo `/galaxy/` que no sea `/galaxy/api/*` ni un archivo devuelve `index.html` con 200;
    - `/galaxy` redirige con 308 a `/galaxy/`;
    - una ruta desconocida bajo `/galaxy/api/` devuelve 404 `{ error: 'not_found' }`.
  - **`main.ts`:** lee `loadEnv()`, construye la app y escucha en `0.0.0.0:PORT`. Cierra limpio con `SIGTERM`.

- [ ] **Step 1: Escribir los tests que fallan**

  Se usa un `webDist` temporal con `index.html` y `assets/a.js`. Se comprueba:
  - las cabeceras de caché;
  - que `/galaxy/entrar` devuelve el `index.html`;
  - que `/galaxy/api/nada` devuelve el 404 JSON;
  - la redirección de `/galaxy`;
  - que la CSP está presente en el HTML.

- [ ] **Step 2: Ejecutar y ver que fallan, implementar y ver que pasan**

  Run: `pnpm -C games/galaxy test -- static`
  Expected: primero FAIL y después PASS.

- [ ] **Step 3: Commit**

```bash
git add games/galaxy/apps/server
git commit -m "feat(galaxy): el servidor sirve la web con fallback de SPA y arranca en 8080"
```

---

### Task 8: Sistema de diseño (punto de aprobación del usuario)

**Files:**
- Create: `games/galaxy/docs/DESIGN_SYSTEM.md`, `.superpowers/brainstorm/<sesión>/content/acceso-v1.html` (demo, no se versiona)

**Interfaces:**
- Produces, en `DESIGN_SYSTEM.md`:
  - **Tokens con nombre**, con los valores definitivos:
    - **Color:** `--void`, `--panel`, `--panel-2`, `--panel-lip`, `--ink`, `--ink-soft`, `--ink-mute`, `--solar*`, `--nova*`, `--terminal*`, `--uv*`, `--ice` y `--static`.
    - **Radios por jerarquía:** 30, 22, 18 y 999.
    - **Labios de relieve:** 8, 6, 5 y 4 px.
    - **Escala tipográfica** con Bungee y Fredoka.
    - **Espaciado.**
    - **Movimiento:** `--bounce: cubic-bezier(.34,1.56,.64,1)`, hover a 180 ms y pulsación a 60 ms.
  - **Componentes:** `Button` (`primary`, `mode`, `pill`, `icon`), `Panel`, `Field`, `Badge`, `Tabs` y `Toast`, cada uno con sus estados: reposo, hover, pulsado, foco, deshabilitado y cargando.
  - **Reglas:**
    - accesibilidad;
    - pantallas anchas (GDD §17.2);
    - qué se anima y qué no;
    - fondo vivo y `prefers-reduced-motion`.
  - **Copy:** voz, títulos y errores.

- [ ] **Step 1: Consultar ui-ux-pro-max**

  Run: `python "C:/Users/rayel/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.15.0/.claude/skills/ui-ux-pro-max/scripts/search.py" "<consulta>" --domain <ux|typography|color>` para:
  - formularios de acceso;
  - foco y errores en línea;
  - contraste de los tonos sobre `--panel`.

  Se anotan en el documento las recomendaciones aplicadas.

- [ ] **Step 2: Medir el contraste de cada par texto/fondo** con un script desechable que calcule la relación WCAG. Ningún texto puede quedar por debajo de 4,5:1, y los que no lleguen se ajustan.

- [ ] **Step 3: Construir la demo de alta fidelidad de las pantallas de acceso** en el visual companion: Entrar, Crear cuenta, Verificar (TOTP) y Recuperar contraseña.
  - Sigue el listón de la memoria `feedback-visual-demos`: animada, sobre el fondo vivo de `titulo-v2.html`, con los botones con relieve.
  - Se revisa con una captura en Edge sin ventana, con `?shot`.

- [ ] **Step 4: Preguntar al usuario los títulos de las cuatro pantallas** como preguntas de opciones con respuesta libre.

- [ ] **Step 5: STOP. El usuario aprueba la demo y `DESIGN_SYSTEM.md`.** No se empieza la Tarea 9 sin esa aprobación. Sus cambios se incorporan y se vuelve a enseñar.

- [ ] **Step 6: Commit**

```bash
git add games/galaxy/docs/DESIGN_SYSTEM.md
git commit -m "docs(galaxy): sistema de diseño aprobado"
```

---

### Task 9: Web de acceso

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,index.html,vite.config.ts,playwright.config.ts}`, `apps/web/public/fonts/{bungee-regular.woff2,fredoka-variable.woff2}` (OFL, autoalojadas), `apps/web/src/**` del mapa de archivos, `apps/web/e2e/{auth.spec.ts,global-setup.ts}`
- Modify: `.github/workflows/galaxy-ci.yml` (añadir el e2e con `pnpm exec playwright install --with-deps chromium`)
- Test: `apps/web/test/{api-client,desktop-gate,entrar,crear-cuenta,verificar}.test.tsx` (proyecto Vitest `web`), `apps/web/e2e/auth.spec.ts`

**Interfaces:**
- Consumes:
  - las rutas de las Tareas 4–6;
  - `MeResponse`, `LoginResponse`, `ApiErrorCode` y los esquemas de `@galaxy/shared`;
  - los tokens de `DESIGN_SYSTEM.md`.
- Produces:
  - **`api<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T>`:**
    - va contra `/galaxy/api`, con `credentials: 'same-origin'` y JSON;
    - con un error lanza `ApiError { code: ApiErrorCode; status: number }`;
    - si recibe 503 `maintenance`, cambia el store global a `maintenance = true`.
  - **`useMe()`:** TanStack Query sobre `['me']`. Un 401 devuelve `null` en vez de un error, para que no haya bucles de redirección.
  - **Rutas** (React Router con `basename: '/galaxy'`):

    | Ruta | Contenido |
    |---|---|
    | `/entrar` | Entrar |
    | `/crear-cuenta` | Crear cuenta |
    | `/verificar` | Recibe el desafío en el estado de navegación, nunca en la URL |
    | `/recuperar` | Recuperar contraseña |
    | `/` | Inicio provisional: saludo con el nombre, insignia si es admin y «Salir» |

    - Sin sesión, `/` lleva a `/entrar`.
    - Con sesión, `/entrar` y `/crear-cuenta` llevan a `/`.
  - **`isDesktopCapable(w: { innerWidth: number; innerHeight: number; matchMedia(q: string): { matches: boolean } }): boolean`** exige `innerWidth >= 1280`, `innerHeight >= 720` y `(pointer: fine)`. `DesktopGate` muestra la pantalla «Galaxy Survivor se juega en ordenador» si no se cumple.
  - **Textos:** `copy/es.ts` tiene todos los textos y `errors: Record<ApiErrorCode, string>`, que se comprueba exhaustivo con `satisfies`.
  - **Fondo:** `AuthBackdrop` porta el fondo de la demo aprobada (cielo tramado, estación, galaxia braille decorativa). Con `prefers-reduced-motion` queda estático. Es decoración, no el motor de M2a.

- [ ] **Step 1: Escribir los tests de componentes que fallan**

  - `api-client`:
    - un 401 lanza `ApiError` con `code 'unauthenticated'`;
    - un 503 `maintenance` activa el store.
  - `desktop-gate`: 1279×720 da falso, 1280×720 con puntero fino da verdadero, y sin puntero fino da falso.
  - `entrar`:
    - un error `invalid_credentials` muestra el texto de `copy.errors` en la región `role="alert"` asociada al formulario;
    - con `totp_required` navega a `/verificar` sin poner el desafío en la URL.
  - `crear-cuenta`: valida en línea con `registerInput` antes de enviar, con un mensaje junto al campo.
  - `verificar`: solo acepta 6 dígitos y lleva `autocomplete="one-time-code"`.

- [ ] **Step 2: Ejecutar y ver que fallan**

  Run: `pnpm -C games/galaxy test:unit`
  Expected: FAIL.

- [ ] **Step 3: Implementar la web**

  - Vite con `base: '/galaxy/'`, y `server.proxy` que manda `/galaxy/api` a `http://localhost:8080`.
  - Tailwind v4 con los tokens en `@theme`.
  - Todos los componentes salen de `DESIGN_SYSTEM.md`.

- [ ] **Step 4: Ejecutar y ver que pasan**

  Run: `pnpm -C games/galaxy test:unit && pnpm -C games/galaxy typecheck && pnpm -C games/galaxy lint`
  Expected: PASS.

- [ ] **Step 5: Escribir el e2e que falla** (`auth.spec.ts`)

  - **`webServer`:** ejecuta `pnpm -C ../.. build` y luego el servidor con `WEB_DIST=apps/web/dist`, `GALAXY_PUBLIC_ORIGINS=http://localhost:8080`, la BD local de desarrollo y una `GALAXY_TOTP_KEY` de test. La URL base es `http://localhost:8080/galaxy/`.
  - **`global-setup.ts`:** ejecuta `node apps/server/dist/cli.js create-admin <e2e_admin_aleatorio> --role admin --json` y guarda las credenciales.
  - **Casos:**
    - crear cuenta, ver el saludo, salir, entrar con el nombre en mayúsculas y ver el saludo;
    - un admin entra con contraseña, después con el código TOTP calculado con `otpauth` y ve la insignia;
    - tras salir, ir a `/galaxy/` lleva a «Entrar» y no hay bucle (Review Focus 3);
    - con un viewport de 1024×700 aparece la pantalla de «solo ordenador»;
    - la cabecera CSP está en la respuesta del documento.

- [ ] **Step 6: Ejecutar el e2e**

  Run: `pnpm -C games/galaxy/apps/web exec playwright test`
  Antes, en Git Bash, añadir `/c/Windows/System32` al final del PATH. Avisar al usuario: escribe cuentas `e2e_*` en el esquema `galaxy` de su BD local.
  Expected: PASS.

- [ ] **Step 7: Revisar con capturas**

  Se hace una captura en Edge sin ventana de cada pantalla a 1280×720, a 1920×1080 y a 3440×1440. Se comparan con la demo aprobada; anclajes, contraste y foco tienen que estar bien.

- [ ] **Step 8: Commit**

```bash
git add games/galaxy/apps/web .github/workflows/galaxy-ci.yml
git commit -m "feat(galaxy): pantallas de acceso con el sistema de diseño y e2e"
```

---

### Task 10: Contenedor, túnel, pipeline y puesta en PRE

**Files:**
- Create: `games/galaxy/Dockerfile`, `games/galaxy/.dockerignore`, `deploy/preprod/galaxy.env.example`, `games/galaxy/docs/DEPLOY_PRE.md`
- Modify: `deploy/preprod/docker-compose.yml`, `deploy/preprod/cloudflared/config.yml`, `.github/workflows/preproduction.yml`
- Test: `games/galaxy/apps/server/test/unit/deploy-config.test.ts`

**Interfaces:**
- **Imagen `elclub-galaxy:pre`:**
  - etapas `deps → build → run` sobre `node:22-bookworm-slim` con `corepack enable`;
  - `pnpm install --frozen-lockfile --ignore-scripts`;
  - `pnpm build`, que genera `apps/web/dist` y `apps/server/dist`;
  - la etapa `run` copia solo `apps/server/dist` con sus dependencias de producción (`pnpm deploy --prod`) y `apps/web/dist` en `/app/web-dist`;
  - usuario `uid 1001`, `EXPOSE 8080` y `CMD ["node", "dist/main.js"]`.
- **Servicio `galaxy` en compose:**
  - `build.context: ../../games/galaxy` y `env_file: ${GALAXY_ENV_FILE:-/opt/elclub/pre/galaxy.env}`;
  - `ports: ["127.0.0.1:8080:8080"]` y `networks: [default, supabase_default]`;
  - `read_only: true` con `tmpfs: [/tmp]`, `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]` y `restart: unless-stopped`;
  - `cloudflared` pasa a tener `depends_on: [web, galaxy]`.
- **Túnel:** esta regla va **antes** de la de `pre.elclub.party`:

  ```yaml
    - hostname: pre.elclub.party
      path: ^/galaxy(/|$)
      service: http://galaxy:8080
  ```

- **Pipeline (`preproduction.yml`):**
  - Build: `$COMPOSE build web galaxy`.
  - Restart: `$COMPOSE up -d --no-build web galaxy cron cloudflared`. Solo se recrea `galaxy` si cambia su imagen.
  - Smoke: igual que el de web, contra `http://127.0.0.1:8080/galaxy/api/health`, exigiendo `"ok":true`.
- **`galaxy.env.example`:**
  - `DATABASE_URL=postgresql://galaxy_api:@db:5432/postgres?sslmode=disable`, con la contraseña vacía en el ejemplo;
  - `GALAXY_PUBLIC_ORIGINS=https://pre.elclub.party`;
  - `GALAXY_TOTP_KEY=`, que se genera con `openssl rand -base64 32`;
  - `NODE_ENV=production`.

  Lleva comentarios en el estilo de `web.env.example`.

- [ ] **Step 1: Escribir el test que falla** (`deploy-config.test.ts`). Lee los YAML del repo con `yaml` y comprueba:
  - en `cloudflared/config.yml`, la primera regla con `hostname: pre.elclub.party` tiene `path: ^/galaxy(/|$)` y `service: http://galaxy:8080`, y aparece antes que la regla general de `pre.elclub.party`;
  - en `docker-compose.yml`, `galaxy` tiene `read_only: true`, `cap_drop: [ALL]`, el puerto ligado a `127.0.0.1` y la red `supabase_default`;
  - `preproduction.yml` contiene `/galaxy/api/health` en el smoke.

- [ ] **Step 2: Ejecutar y ver que falla. Hacer los cambios y ver que pasa**

  Run: `pnpm -C games/galaxy test:unit -- deploy-config`
  Expected: primero FAIL y después PASS.

- [ ] **Step 3: Probar la imagen en local**

  Run:
  ```bash
  docker build -t elclub-galaxy:test games/galaxy
  docker run --rm -d --name galaxy-test -p 18080:8080 -e DATABASE_URL=postgresql://galaxy_api:galaxy_dev@host.docker.internal:54322/postgres -e GALAXY_PUBLIC_ORIGINS=http://localhost:18080 -e GALAXY_TOTP_KEY=$(openssl rand -base64 32) elclub-galaxy:test
  curl -fsS http://localhost:18080/galaxy/api/health
  curl -sI http://localhost:18080/galaxy/ | grep -i content-security-policy
  docker rm -f galaxy-test
  ```
  Expected: `{"ok":true,"db":"up"}`, la CSP exacta, y el contenedor arranca con `read_only`.

- [ ] **Step 4: Escribir `DEPLOY_PRE.md`**, el procedimiento en el host `root@192.168.1.103`:
  1. Crear `/opt/elclub/pre/galaxy.env` desde el ejemplo, con `chmod 600` y como propietario el usuario del runner.
  2. Antes del primer despliegue, crear el rol `galaxy_api` con `login` y contraseña. Se usa el mismo bloque `do $$ … if not exists … create role` de la migración, seguido de:
     ```bash
     docker exec -e PGPASSWORD supabase-db psql -U postgres -h 127.0.0.1 -d postgres -c "alter role galaxy_api login password '…'"
     ```
     La contraseña va por la entrada estándar o por una variable, nunca en el historial. La migración, al ser idempotente, respeta el rol ya creado.
  3. Comprobar que el `PGRST_DB_SCHEMAS` del Supabase de PRE **no** incluye `galaxy`.
  4. Tras el despliegue, **el usuario** crea su cuenta en su propia sesión SSH, para que la contraseña y el secreto solo aparezcan en su terminal:
     ```bash
     docker compose --env-file /opt/elclub/pre/web.env -f deploy/preprod/docker-compose.yml exec galaxy node dist/cli.js create-admin rayelus --role superadmin
     ```
  5. Cómo rotar `GALAXY_TOTP_KEY`. Rotarla invalida los TOTP existentes y hay que volver a enrolar.

- [ ] **Step 5: Preparar el host antes de fusionar el PR. Pedir confirmación al usuario antes de tocarlo.**

  **Por qué antes:** el pipeline va build → migrar → reiniciar → smoke. Si `galaxy_api` no tiene contraseña cuando arranca el contenedor, el primer smoke de galaxy falla.

  1. Crear `/opt/elclub/pre/galaxy.env`.
  2. Crear el rol ya con `login` y contraseña, con el mismo bloque `do $$ … if not exists … create role galaxy_api …` de la migración, seguido de `alter role galaxy_api login password …`.

  La migración es idempotente: ve el rol creado y lo deja como está.

- [ ] **Step 6: Verificación completa antes del PR**
  - Run: `pnpm -C games/galaxy typecheck && pnpm -C games/galaxy lint && pnpm -C games/galaxy test && pnpm exec supabase test db`, y el e2e de la Tarea 9.
  - En la raíz, `pnpm typecheck && pnpm lint && pnpm test:unit`.
  - Expected: todo en verde. Se pega la salida en el PR.

- [ ] **Step 7: Commit y PR**

```bash
git add games/galaxy deploy/preprod .github/workflows/preproduction.yml
git commit -m "feat(galaxy): contenedor, túnel, smoke y procedimiento de PRE"
git push -u origin feature/galaxy-survivor
gh pr create --base develop --title "Galaxy Survivor M1: esqueleto, cuentas y PRE" --body "<resumen, verificación con salidas y pasos manuales de DEPLOY_PRE.md>"
```

  El usuario fusiona el PR. Después se comprueba el despliegue en PRE:
  - `curl https://pre.elclub.party/galaxy/api/health` responde `{"ok":true,"db":"up"}`;
  - `https://pre.elclub.party/galaxy/` muestra «Entrar» con la CSP propia;
  - `https://pre.elclub.party/` sigue sirviendo ElClub igual que antes;
  - el usuario crea `rayelus` con el paso 4 de `DEPLOY_PRE.md` y entra con TOTP.
