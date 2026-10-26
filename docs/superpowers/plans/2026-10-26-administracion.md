# Administración Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pestaña «Administración» (`/foro/settings/administracion`, solo SuperAdmin) con interruptores de las herramientas públicas y del registro, modo mantenimiento (por defecto o personalizado y programable) con «Acceso del equipo» de doble llave, lista de acceso, historial auditado, y páginas propias de mantenimiento (503), «herramienta no disponible» (503) y 404 (ES/EN/foro).

**Architecture:** El estado no secreto (interruptores y configuración del mantenimiento) vive en `app_config` y se lee con una RPC pública, `site_state()`. El proxy y las páginas la leen con `getSiteState()`: un `fetch` a PostgREST con la clave anónima, guardado en una caché en memoria de 5 s y con fail-open. El proxy decide con una función pura (`gateDecision`): reescribe a `/status/[lang]/maintenance` o a `/status/[lang]/unavailable` con 503, o responde JSON 503. El acceso del equipo es una fila en BD (`maintenance_grants`) atada al usuario de Supabase, a su wallet y a la versión de la contraseña. La contraseña se guarda solo como hash scrypt y se comprueba en `/api/team-access`, que no pasa por el mantenimiento. Cerrar el registro deja una «retención» en las cuentas nuevas (trigger en `auth.users`), y el cierre de sesión pública borra esas cuentas.

**Tech Stack:** Next.js 16.4.1 (proxy en Node, cacheComponents, `connection()`, `not-found.tsx`), React 19, Tailwind v4, Supabase (RLS, pgTAP), wagmi 3.7.7 / viem 2.57.7 (SIWE), `node:crypto` (`scrypt`, `timingSafeEqual`), Vitest, Playwright. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-10-26-administracion-design.md`. Se apoya en:
- `src/proxy.ts`: sus guardas 404 con `NextResponse.rewrite(..., { status })` y `x-pathname`;
- el patrón de RPCs auditadas de SuperAdmin de «Economía» (`set_chain_enabled`, `src/lib/economy/actions.ts`);
- `settingsSections` y `isHiddenSettingsPage`;
- `ip_rate_limit_hit` / `rate_limit_hit` con `hitIpRateLimit` / `hitRateLimit`;
- `PublicConnect` y `completeLogin`;
- `toInternalPath` / `localizedPath`;
- los helpers de e2e `loginAs`, `installTestWallet`, `signInPublic` y `rpcAs`.

## Global Constraints
- **Rama:** `feature/administracion` desde `develop` (worktree `C:\Users\rayel\Desktop\Proyectos\elclublambo\.claude\worktrees\f2-foro`). Commits en español con formato convencional.
- **Quién:** SuperAdmin = bit `ADMINISTRATOR` (512) en bruto, como «Economía». Solo él ve y usa «Administración».
- **Estado:** en Supabase, con RLS. Las escrituras solo pasan por RPC o servidor. Cada cambio de administración queda en `audit_log` con una acción `admin.*`.
- **Por defecto:** todos los interruptores encendidos y el mantenimiento apagado.
- **Build sin secretos:** `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build` debe pasar. Ninguna página lee el estado sin `await connection()` antes, y el proxy no corre en la build.
- **Nunca en el cliente ni en los logs:** la contraseña, su hash y la lista de acceso. Los logs solo llevan códigos (`safeError`).
- **Códigos HTTP:**
  - 503 en mantenimiento y en «herramienta no disponible»;
  - 404 solo en la 404;
  - `Retry-After` en mantenimiento;
  - `noindex` en las tres páginas.
- **Colores (R2):**
  - como mucho un relleno `bg-accent-fill` (Base Blue) por pantalla;
  - acentos, foco y enlaces en Cerulean (`--accent`);
  - sin hex en componentes;
  - tipografía Archivo / DM Sans / JetBrains Mono.
- **UI:** usar las pautas de `ui-ux-pro-max` antes de construir cada pantalla. Además:
  - AA;
  - foco visible;
  - objetivos ≥ 44 px;
  - de 375 a 1440 px sin scroll horizontal;
  - las animaciones respetan `prefers-reduced-motion`.
- **i18n:** ES/EN con los diccionarios existentes (`src/lib/i18n/dictionaries/{es,en}.ts`), con la paridad de claves que exige `tests/unit/i18n/dictionaries.test.ts`. Las rutas del club se construyen con `clubPath()` y nunca con «/foro/…» escrito a mano.
- **Tests:**
  - TDD estricto;
  - mientras el usuario prueba, solo `pnpm test:unit`;
  - `pnpm test`, `pnpm db:test` y el e2e borran la BD local (autorizado);
  - solo wallets de prueba de Hardhat y la clave de prueba de SuperAdmin.

## Review Focus
1. **La lectura del estado falla o tarda** (Supabase caído, timeout, JSON roto, una clave que falta). La web sigue abierta y ninguna petición espera más de 1,5 s. Mientras dura el TTL sale un solo log y no se reintenta en cada petición. Una clave ausente cuenta como encendida. Test en Task 2.
2. **Bordes de la programación y husos horarios:**
   - `now === endsAt` → apagado;
   - `startsAt` futuro → apagado;
   - `startsAt` pasado sin `endsAt` → encendido;
   - el `datetime-local` del SuperAdmin se guarda como ISO UTC desde su hora local;
   - la hora de vuelta se muestra en la hora local del visitante.

   Tests en Task 2 y Task 6.
3. **Un visitante intenta saltarse el mantenimiento:**
   - cookie de franja `elclub-mnt=1` falsa;
   - cabecera `x-pathname` o `RSC: 1` inventada;
   - visita directa a `/status/es/maintenance`;
   - `POST` a una página.

   Siempre recibe 503 o 404, nunca el contenido. Test en Task 3.
4. **El SuperAdmin no se queda fuera:**
   - si la RPC de acceso falla, la wallet de `SUPER_ADMIN_WALLET` sigue pasando;
   - puede activar el mantenimiento sin contraseña fijada, y entonces la pestaña avisa «Sin contraseña, solo tú podrás entrar»;
   - la propia pestaña y `/api/team-access` siguen alcanzables.

   Tests en Task 3 y Task 6.
5. **Revocación con la pestaña abierta.** Si se quita una wallet, se cambia la contraseña o se apaga el mantenimiento, en la siguiente petición (tras el TTL, ≤ 5 s) esa persona ya no pasa. Un acceso concedido con una versión anterior de la contraseña nunca vale. Una wallet escrita en mayúsculas se trata como la misma. Tests en Task 1 (pgTAP) y Task 3.

## Decisiones del constructor (rulings; coste si es incorrecta)
- **A-R1 Dónde se guarda:**
  - **Lo no secreto, en `app_config`:**
    - `site_switches`: `{"giveaways":true,"pay":true,"checker":true,"vouches":true,"approvals":true,"multisend":true,"gas":true,"donate":true,"checkerApi":true,"registration":true}`;
    - `maintenance`: `{"enabled":false,"mode":"default","messageEs":null,"messageEn":null,"returnAt":null,"startsAt":null,"endsAt":null}`.
  - **Lo privado, en tablas `public.*` con RLS activada, sin políticas y con `revoke all` a `anon` y `authenticated`** (el patrón de `chain_config`; el e2e limpia con `service_role`):
    - `maintenance_access_wallets (wallet text pk check '^0x[0-9a-f]{40}$', note text check (char_length ≤ 80), added_by uuid, created_at)`;
    - `maintenance_password` (una sola fila: `id boolean pk default true check (id)`, `password_hash text`, `version int not null default 0`, `updated_at`);
    - `maintenance_grants (auth_user_id uuid pk references auth.users on delete cascade, wallet text, password_version int, expires_at timestamptz)`;
    - `registration_holds (auth_user_id uuid pk references auth.users on delete cascade, created_at)`.
  - **Por qué:** `app_config` lo leen los miembros activos, así que el hash no puede ir ahí.

  (Bajo.)
- **A-R2 RPCs** (todas `security definer`, con `set search_path = ''`):
  - `site_state()` (anon y authenticated);
  - `admin_overview()`, `admin_set_switch`, `admin_set_maintenance`, `admin_set_maintenance_password`, `admin_add_access_wallet` y `admin_remove_access_wallet` (authenticated; dentro, `has_global_perm(512)` o `forbidden`);
  - `my_maintenance_access()` y `my_registration_blocked()` (authenticated);
  - `maintenance_password_record()` y `grant_maintenance_access()` (solo `service_role`);
  - acciones de auditoría: `admin.switch`, `admin.maintenance`, `admin.maintenance_password` (payload `{}`), `admin.access_add` y `admin.access_remove`.

  (Bajo.)
- **A-R3 Lectura barata en el proxy:**
  - **Lectura:** `getSiteState()` hace `POST {serverSupabaseUrl()}/rest/v1/rpc/site_state` con la clave anónima y `AbortSignal.timeout(1500)`.
  - **Caché:** en memoria del módulo, con TTL `SITE_STATE_TTL_MS` (5000 por defecto; el e2e usa `0`). Las peticiones simultáneas comparten la misma promesa.
  - **Fallo:** cualquier error devuelve `OPEN_STATE` (todo encendido, sin mantenimiento) y se guarda en caché durante el TTL. Sale un solo `console.error("[site-state] read failed", safeError(e))` por ventana.
  - **Sin `server-only` ni service role:** el proxy no los necesita.
  - **Build:** no la toca. El proxy no corre en ella y las páginas llaman a `connection()` antes de leer.
  - **Caché best-effort:** los docs de Next avisan de que el proxy no debe depender de globales (`proxy.md`), así que la caché solo ahorra lecturas; nunca decide nada.

  (Medio: con varias instancias, cada una calienta su caché, y un cambio tarda como mucho 5 s en notarse.)
- **A-R4 Acceso del equipo = fila en BD, no cookie firmada:**
  - `maintenance_grants` está atada a `auth.uid()`, que el proxy ya valida con `getUser()`, a la wallet de esa sesión y a `password_version`;
  - **por qué:** el proxy no necesita ningún secreto, así que la build sin secretos sigue igual; manipular cookies no sirve de nada, y la revocación es un `join`;
  - **caché del proxy:** `maintenanceAccess()` guarda en memoria solo los resultados positivos (`superadmin`, `granted`), 5 s por usuario y hasta 500 entradas (al pasarse, se vacía);
  - **los negativos no se guardan:** así, quien acaba de entrar con la contraseña pasa en su siguiente recarga.

  (Medio: mientras dura el mantenimiento, una RPC por petición de un usuario con sesión pero sin acceso. Los anónimos no cuestan nada extra.)
- **A-R5 Invalidación:**
  - **cambiar la contraseña:** `version + 1` y se borran todos los accesos;
  - **quitar una wallet:** se borran sus accesos. Además, `my_maintenance_access()` exige que la wallet siga en la lista;
  - **apagar el mantenimiento** (`p_enabled = false` y `p_starts_at` null): se borran todos;
  - **caducidad:** `expires_at = least(now() + 12 h, endsAt)`;
  - **otra wallet** es otro usuario de Supabase, y cerrar sesión deja sin `auth.uid()`;
  - **al acabar** (o con `endsAt` pasado), el proxy deja de mirar los accesos.

  (Bajo.)
- **A-R6 Anti-bloqueo del SuperAdmin.** Pasa si la wallet de la sesión es `SUPER_ADMIN_WALLET` (`isSuperAdminWallet`, sin BD) o si `my_maintenance_access()` devuelve `superadmin` (bit 512 activo). No tiene contraseña: entra solo firmando. (Bajo.)
- **A-R7 Lo que el mantenimiento deja pasar:**
  - lo que el `matcher` ya excluye (`/_next/`, `favicon.ico`, `sw.js` e imágenes): CSS, JS, fuentes e imágenes;
  - `/api/cron/*` (con su secreto) y `/api/webhooks/*` (prefijo reservado; hoy no hay ninguno);
  - `/api/team-access`, `/robots.txt`, `/sitemap.xml` y las imágenes OG internas (`isInternalImagePath`).
  - **Login:** `/foro/login` **no** pasa. «Acceso del equipo» firma en la propia página de mantenimiento: el navegador habla directo con Supabase y luego solo llama a `/api/team-access`.
  - **`/status/*` directo:** siempre 404, con o sin mantenimiento.

  (Bajo: un webhook futuro deberá colgar de `/api/webhooks/`.)
- **A-R8 Respuestas 503:**
  - **Páginas** (GET/HEAD fuera de `/api/`): `NextResponse.rewrite` a `/status/{lang}/maintenance`, con estado 503. Para la herramienta, a `/status/{lang}/unavailable`, también con 503.
  - **Cabeceras:** las dos llevan `Cache-Control: no-store` y `X-Robots-Tag: noindex`. Solo el mantenimiento lleva `Retry-After`, en segundos:
    - con `returnAt`: `clamp(ceil((returnAt − now) / 1000), 60, 86400)`;
    - sin él: `3600`.
  - **El resto** (otros métodos, `/api/*` no exentas): `NextResponse.json({ error: "maintenance" }, { status: 503 })` con las mismas cabeceras.
  - **Interruptor de la API:** `{ error: "unavailable" }` y 503, devuelto en el proxy antes del handler, así que x402 nunca cobra.

  (Bajo.)
- **A-R9 Qué corta un interruptor, para dejar terminar lo que está en curso:**
  - **Páginas:** solo las cargas de documento, `GET`/`HEAD` sin la cabecera `RSC: 1`.
  - **Pasan:**
    - las acciones de servidor (`POST`) de una página ya abierta, como registrar un pago enviado o refrescar un aval;
    - las navegaciones dentro de la app, por ejemplo el `router.push` al recibo tras pagar o a la ficha de un sorteo recién creado.
  - **API:** `/api/v1/check/*` se corta con cualquier método.
  - **Cobertura de cada interruptor:**

    | Interruptor | Qué corta |
    |---|---|
    | `checker` | `tools/checker` |
    | `checkerApi` | `tools/checker/api` (la página de la API) y `/api/v1/check/*` |
    | `pay` | `tools/pay` y `pay/*` (recibos incluidos) |
    | `donate` | `/donar` y `/en/donate` |
    | `giveaways` | `tools/giveaways/*`, incluidos `entries` y las imágenes OG |

  - El SuperAdmin no se salta los interruptores.

  (Medio: una pestaña antigua puede seguir navegando dentro de la herramienta hasta recargar. Es justo lo que pidió el dueño.)
- **A-R10 Contraseña:**
  - **Hash:** `scrypt` de `node:crypto` (no hay bcrypt ni argon2 en las dependencias), con N = 2^15, r = 8, p = 1, `keylen` 64, sal de 16 bytes y `maxmem` de 64 MiB.
  - **Formato:** `scrypt$32768$8$1$<sal b64>$<hash b64>`, comprobado en SQL con el regex `^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$`.
  - **Longitud:** de 12 a 128 caracteres.
  - **Comparación:** con `timingSafeEqual`.
  - **Límite de intentos** (los golpes se cobran **antes** de mirar la lista o el hash, en su propia transacción):
    - por IP, `ip_rate_limit_hit('maintenance_password')`: 20 cada 15 min;
    - por sesión, `rate_limit_hit('maintenance_password')`: 5 cada 15 min (sujeto `u:<uid>` o el miembro).

  (Bajo.)
- **A-R11 Programación:**
  - `isMaintenanceActive(m, now) = (m.enabled || (m.startsAt !== null && now >= startsAt)) && (m.endsAt === null || now < endsAt)`, evaluado en TypeScript en cada comprobación, sin cron;
  - la modalidad «Por defecto» no admite programación, mensajes ni `returnAt`, que se guardan como null;
  - la «Personalizada» exige los dos mensajes, de 1 a 500 caracteres;
  - `returnAt`, si lo hay, debe ser `> now()`;
  - con `startsAt` y `endsAt`, debe cumplirse `endsAt > startsAt`;
  - con `endsAt`, debe cumplirse `endsAt > now()`;
  - cualquier otro caso → `maintenance_invalid`.

  (Bajo.)
- **A-R12 Idioma de las páginas de estado** (`statusLang(pathname, acceptLanguage)`):
  - `/en` y `/en/*` → `en`;
  - `/`, `/donar` y toda ruta con `toInternalPath(...).lang === "es"` → `es`;
  - lo demás (`/foro/*`, `/api/*`, desconocidas) → `en` si la primera etiqueta de `Accept-Language` empieza por `en`, si no `es`.

  (Bajo.)
- **A-R13 Registro cerrado:**
  - **Retención:** el trigger `after insert on auth.users` (`private.hold_registration()`) inserta en `registration_holds` si `site_switches.registration` es `false`. Nunca lanza, así que GoTrue no se rompe.
  - **Bloqueo:** `my_registration_blocked()` = registro cerrado ∧ hay retención ∧ no hay fila en `members`. `is_public_account()` gana `and not public.my_registration_blocked()`; es el cierre real para quien entre por la API de GoTrue sin pasar por la app.
  - **Al firmar:** `enforcePublicRegistration()` borra la cuenta nueva (`auth.admin.deleteUser`) y cierra la sesión. La llaman `completeLogin(…, "public")` y la acción `publicRegistrationGate()`, que `PublicConnect` llama antes de navegar para poder mostrar el mensaje.
  - **Lo que no cambia:** las invitaciones del club y el arranque del SuperAdmin; quien canjea una invitación pasa a tener fila en `members`.
  - **Al reabrir:** se borran todas las retenciones.

  (Medio: una cuenta creada por la API de GoTrue mientras el registro está cerrado existe, pero no puede usar nada público.)
- **A-R14 404:**
  - un único `src/app/not-found.tsx` en la raíz: hay un solo root layout, así que no hace falta `global-not-found` (`not-found.md`);
  - cubre las URLs sin ruta, todo `notFound()` y los rewrites 404 del proxy (`NOT_FOUND_PATH`);
  - la variante sale de `x-pathname`, que el proxy fija en cada petición: `/en…` → `en`, `/foro…` → `foro` (en español, con enlace al foro) y lo demás → `es`;
  - lee `headers()` dentro de `<Suspense>`.

  (Bajo.)
- **A-R15 Franja «Mantenimiento activo».** El proxy fija la cookie `elclub-mnt=1` (sin `httpOnly`, `sameSite: lax`, `path: /`) en las respuestas que deja pasar a quien tiene acceso durante el mantenimiento, y la borra si está y ya no aplica. `MaintenanceBanner` (cliente, en `Providers`) la lee en cada cambio de ruta. Es solo cosmética: falsificarla no abre nada. (Bajo: un parpadeo de la franja tras hidratar.)
- **A-R16 Hub y landing:**
  - **Lectura:** el estado se lee dentro de `<Suspense>`, tras `await connection()`, con `getSiteState()`.
  - **Hub:** la tarjeta apagada se queda sin enlace, atenuada (`opacity-60`) y con «No disponible ahora». El fallback del hub es la cabecera con la lista vacía de altura mínima.
  - **Landing, qué se oculta:**
    - `GiveawayDemo` y los dos `CreateLink` (Hero y FinalCta) si `giveaways` está apagado;
    - `PayDemo` y `PayLink` si `pay` está apagado;
    - `CheckerDemo` si `checker` está apagado;
    - la fila Pay + Comprobador si ambos están apagados;
    - `VouchTeaser` si `vouches` está apagado;
    - `MoreToolsTeaser` solo si `approvals`, `multisend` y `gas` están apagados a la vez, porque enlaza al hub y no a ellas.
  - **Landing, fallback:** `<main className="flex-1" aria-busy="true" />`.
  - **Cabecera y pie:** no cambian, porque no enlazan herramientas sueltas.
  - **Relleno:** con `giveaways` apagado la landing se queda sin relleno; no se promueve otro.

  (Medio: la landing deja de ser estática; el estado viene de la caché en memoria.)
- **A-R17 Relleno por pantalla:**
  - **mantenimiento:** ninguno hasta que se abre el panel; dentro, «Entrar» (contraseña) o «Firmar y entrar» es el único;
  - **no disponible:** «Ver herramientas»;
  - **404:** «Volver al inicio» (en el foro, «Volver al foro»);
  - **pestaña Administración:** solo «Guardar mantenimiento»; el resto, `outline`;
  - **«Acceso del equipo»:** un botón de texto discreto.

  (Bajo.)
- **A-R18 Confirmaciones** (`AlertDialog`, «Confirmar» y «Cancelar»):
  - **dónde:** al apagar un interruptor y al guardar un mantenimiento que queda activo ahora o programado;
  - **dónde no:** al encender, al quitar el mantenimiento y en la lista de acceso.

  (Bajo.)
- **A-R19 Firmar con una wallet fuera de la lista** da «Esta wallet no tiene acceso durante el mantenimiento.». Solo habla de la wallet que acaba de demostrar que es suya, sin revelar nada de otras, y sigue el flujo literal del spec («si la wallet está en la lista, se pide la contraseña»). Una contraseña mala da «Contraseña incorrecta.». (Bajo.)
- **A-R20 Textos** (fijados aquí; ES / EN):

  | Clave (`status.*`) | ES | EN |
  |---|---|---|
  | `maintenanceTitle` | Volvemos enseguida | Back shortly |
  | `maintenanceText` | Estamos haciendo mantenimiento. La web está cerrada un rato mientras ajustamos tuercas. | We're doing maintenance. The site is closed for a bit while we tighten some bolts. |
  | `returnAt` | Vuelta estimada: {time} | Estimated return: {time} |
  | `teamAccess` | Acceso del equipo | Team access |
  | `passwordLabel` | Contraseña de mantenimiento | Maintenance password |
  | `enter` | Entrar | Enter |
  | `notListed` | Esta wallet no tiene acceso durante el mantenimiento. | This wallet has no access during maintenance. |
  | `wrongPassword` | Contraseña incorrecta. | Wrong password. |
  | `tooManyAttempts` | Demasiados intentos. Espera unos minutos. | Too many attempts. Wait a few minutes. |
  | `banner` | Mantenimiento activo: la web está cerrada al público | Maintenance on: the site is closed to the public |
  | `unavailableTitle` | Esta herramienta no está disponible ahora | This tool isn't available right now |
  | `unavailableText` | La hemos pausado un momento. Las demás siguen abiertas. | We've paused it for a moment. The others are still open. |
  | `seeTools` | Ver herramientas | See tools |
  | `notFoundTitle` | Aquí no hay nada | Nothing here |
  | `notFoundText` | Esta página no existe o se ha movido. Pasa hasta en las mejores casas. | This page doesn't exist or has moved. It happens to the best of us. |
  | `backHome` | Volver al inicio | Back to home |
  | `notFoundForoTitle` | Este rincón del foro no existe | This corner of the forum doesn't exist |
  | `backForo` | Volver al foro | Back to the forum |

  Fuera de `status.*`:
  - `tools.unavailableNow`: «No disponible ahora» / «Not available right now»;
  - `connect.errRegistrationClosed`: «El registro de cuentas está cerrado ahora.» / «Account registration is closed right now.».

  La 404 del foro se muestra siempre en español. (Bajo: son textos.)

## Mapa de ficheros

| Fichero | Responsabilidad |
|---|---|
| `supabase/migrations/20261026100001_administracion.sql` | Claves, tablas, RPCs, trigger y buckets (A-R1, A-R2, A-R10, A-R13) |
| `supabase/tests/adm_01_administracion.test.sql` | pgTAP |
| `src/lib/admin/state.ts` | Tipos, `OPEN_STATE`, `parseSiteState`, `isMaintenanceActive` y `retryAfterSeconds` (puro) |
| `src/lib/admin/site-state.ts` | `getSiteState`, la caché y `invalidateSiteState` |
| `src/lib/admin/paths.ts` | `toolForPath`, `isMaintenanceBypass`, `isStatusPath` y `statusLang` (puro) |
| `src/lib/admin/gate.ts` | `gateDecision` (puro) |
| `src/lib/admin/access.ts` | `maintenanceAccess` (proxy, caché positiva) |
| `src/lib/admin/password.ts` | `hashPassword` y `verifyPassword` (`server-only`) |
| `src/app/api/team-access/route.ts` | Estado del acceso y comprobación de la contraseña |
| `src/lib/admin/registration.ts`, `src/lib/admin/registration-actions.ts` | Registro cerrado (A-R13) |
| `src/lib/admin/actions.ts`, `src/lib/admin/overview.ts`, `src/lib/admin/labels.ts` | Pestaña: acciones, lectura y textos del historial |
| `src/app/status/[lang]/{maintenance,unavailable}/page.tsx`, `src/app/not-found.tsx` | Páginas propias |
| `src/components/status/*` | `StatusShell`, `StatusMark`, `TeamAccess`, `LocalTime`, `MaintenanceBanner` y `NotFoundView` |
| `src/components/admin/*` | `ToolSwitches`, `MaintenanceForm`, `AccessList` y `AdminHistory` |

---

### Task 1: Base de datos — estado, acceso, contraseña, historial y registro

**Files:**
- Create: `supabase/migrations/20261026100001_administracion.sql`, `supabase/tests/adm_01_administracion.test.sql`.

**Interfaces:**
- Consumes: `app_config`, `audit_log`, `has_global_perm`, `current_member_id`, `auth_wallet_address`, `private.rate_limit`, `members` (`handle`, `wallet_address`).
- Produces (SQL):
  - Seeds `app_config('site_switches', …)` y `app_config('maintenance', …)` según A-R1. Tablas de A-R1, cada una con `enable row level security` y `revoke all … from anon, authenticated`.
  - `site_state() returns jsonb`: `{"switches": <site_switches>, "maintenance": <maintenance>}`. Execute para `anon` y `authenticated`.
  - `admin_overview() returns jsonb`: `{ switches, maintenance, passwordSet: bool, passwordUpdatedAt: timestamptz|null, accessList: [{ wallet, note, createdAt }] (por created_at), history: [{ at, actor, action, payload }] }`, donde:
    - `history` son las últimas 50 filas de `audit_log` con `action like 'admin.%'`, de la más nueva a la más antigua;
    - `actor` = `'@' || handle`, o `wallet_address` si no hay handle.
  - `admin_set_switch(p_key text, p_enabled boolean) returns void`:
    - una clave fuera de las 10 de A-R1, o un null → `switch_invalid`;
    - `registration = true` borra `registration_holds`;
    - audita `admin.switch {key, enabled}`.
  - `admin_set_maintenance(p_enabled boolean, p_mode text, p_message_es text, p_message_en text, p_return_at timestamptz, p_starts_at timestamptz, p_ends_at timestamptz) returns void`:
    - validación de A-R11; los mensajes se guardan recortados;
    - guarda el JSON con las claves camelCase de A-R1 (fechas ISO);
    - apagado (`not p_enabled and p_starts_at is null`) → borra `maintenance_grants`;
    - audita `admin.maintenance {enabled, mode, returnAt, startsAt, endsAt}`.
  - `admin_set_maintenance_password(p_hash text) returns void`:
    - un formato distinto del de A-R10 → `password_invalid`;
    - hace upsert de la fila única con `version + 1`;
    - borra `maintenance_grants`;
    - audita `admin.maintenance_password {}`.
  - `admin_add_access_wallet(p_wallet text, p_note text) returns void`:
    - `lower(trim(p_wallet))` debe cumplir el regex; si no, `wallet_invalid`;
    - nota recortada: vacía → null, más de 80 → `note_invalid`;
    - upsert que actualiza la nota;
    - audita `admin.access_add {wallet, note}`.
  - `admin_remove_access_wallet(p_wallet text) returns void`: normaliza, borra la wallet y sus `maintenance_grants`, y audita `admin.access_remove {wallet}`. Si no existía, no hace nada y no audita.
  - `my_maintenance_access() returns text` (authenticated), que devuelve:
    - `'superadmin'` si `has_global_perm(512)`;
    - si no, `'granted'` si hay concesión con `auth_user_id = auth.uid()`, `wallet = auth_wallet_address()`, `password_version` = la versión vigente, `expires_at > now()` y la wallet en la lista;
    - si no, `'listed'` si la wallet está en la lista;
    - si no, `'none'`.
  - `maintenance_password_record() returns jsonb` (service_role): `{hash, version}` o `null` si nunca se fijó.
  - `grant_maintenance_access(p_auth_user_id uuid, p_password_version int) returns text` (service_role):
    - la wallet = la primera identidad `web3` de ese usuario (como `auth_wallet_address`);
    - wallet fuera de la lista → `'not_listed'`;
    - versión distinta de la vigente → `'stale'`;
    - si no, upsert con `expires_at = least(now() + interval '12 hours', (maintenance->>'endsAt')::timestamptz)` → `'granted'`.
  - `my_registration_blocked() returns boolean` (authenticated), según A-R13.
  - `private.hold_registration()` y su trigger `after insert on auth.users for each row`.
  - `is_public_account()`: `create or replace`, con la definición de `20261025100001_public_accounts.sql` y `and not public.my_registration_blocked()`.
  - `ip_rate_limit_hit` (ramas copiadas literalmente de `20261025600001_approvals_rate_limit.sql`) y `rate_limit_hit` (ramas copiadas de la última definición, `20261025500001_vouches.sql`) ganan la rama `'maintenance_password'` con los límites de A-R10.
  - Grants: `revoke execute … from public, anon` en todo menos `site_state`. Las funciones de `service_role` también se revocan a `authenticated`.

- [ ] **Step 1: Failing pgTAP** `adm_01_administracion.test.sql` (fixtures como `510_economy_config`: un SuperAdmin, un miembro normal y un usuario de wallet sin membresía):
  - **privilegios:**
    - `anon` ejecuta `site_state()` y no puede `admin_overview()`;
    - `authenticated` no puede `maintenance_password_record()` ni `grant_maintenance_access(uuid,int)`;
    - `anon` y `authenticated` no tienen `select` en las cuatro tablas;
    - ninguna de ellas tiene políticas;
  - **por defecto:** `site_state()` = los dos JSON de A-R1;
  - **el miembro normal** recibe `forbidden` en las seis `admin_*`;
  - **interruptores:** `admin_set_switch('gas', false)` → `site_state()->'switches'->>'gas' = 'false'` y una fila `admin.switch` con payload `{"key":"gas","enabled":false}`; `admin_set_switch('nope', true)` → `switch_invalid`;
  - **mantenimiento** (Review Focus 2):
    - `default` con mensaje → `maintenance_invalid`;
    - `custom` sin `p_message_en` → `maintenance_invalid`;
    - `custom` con `ends ≤ starts` → `maintenance_invalid`;
    - `custom` válido → el JSON guardado lleva `startsAt` y `endsAt` en ISO;
  - **lista** (Review Focus 5): `admin_add_access_wallet('0xABC…', ' Ana ')` y otra vez en minúsculas con otra nota → una sola fila, en minúsculas, con la última nota; `'0x12'` → `wallet_invalid`; una nota de 81 caracteres → `note_invalid`;
  - **acceso** (Review Focus 5):
    - el SuperAdmin → `my_maintenance_access() = 'superadmin'`;
    - un usuario en la lista → `'listed'`;
    - tras `grant_maintenance_access(uid, version)` como `service_role` → `'granted'`;
    - tras `admin_set_maintenance_password(<hash válido>)` → `'listed'`, y `grant_maintenance_access(uid, version_vieja)` → `'stale'`;
    - tras una nueva concesión y `admin_remove_access_wallet` → `'none'`, sin concesión;
    - una concesión con `expires_at` pasado (forzada) → `'listed'`;
    - apagar el mantenimiento borra las concesiones;
  - **contraseña:** `admin_set_maintenance_password('plain')` → `password_invalid`; la fila de auditoría no contiene el hash (`payload = '{}'`);
  - **historial:** `admin_overview()->'history'` trae las acciones `admin.*` más recientes primero y no las de `economy.*`;
  - **registro:**
    - con `registration` encendido, `tests.create_wallet_user` no crea retención;
    - con `false`, sí, y ese usuario → `my_registration_blocked() = true` e `is_public_account() = false`;
    - un `tests.create_member` creado con el registro cerrado → `false` / `true`;
    - reabrir → 0 retenciones;
  - **límites:**
    - `ip_rate_limit_hit(…, 'maintenance_password')`: 20 pasan y el 21.º da `rate_limited`;
    - `rate_limit_hit('maintenance_password')` como usuario: 5 pasan y el 6.º da `rate_limited`;
    - `approvals_scan` y `vouch_write` siguen funcionando.
- [ ] **Step 2: Run** `pnpm db:test`: FAIL (las funciones no existen).
- [ ] **Step 3: Implement** la migración según Interfaces, con un comentario de cabecera que cite los rulings A-R1, A-R2, A-R5, A-R10, A-R11 y A-R13.
- [ ] **Step 4: Run** `pnpm db:test` (todos los ficheros): PASS.
- [ ] **Step 5: Commit** `feat(admin): estado de administración, lista y contraseña de mantenimiento y registro cerrable en la BD`

---

### Task 2: Estado del sitio, rutas y decisión de la puerta (puro + caché)

**Files:**
- Create: `src/lib/admin/state.ts`, `src/lib/admin/site-state.ts`, `src/lib/admin/paths.ts`, `src/lib/admin/gate.ts`.
- Test: `tests/unit/admin/state.test.ts`, `tests/unit/admin/site-state.test.ts`, `tests/unit/admin/paths.test.ts`, `tests/unit/admin/gate.test.ts`.

**Interfaces:**
- Consumes: `toInternalPath` (`src/lib/i18n/routes.ts`), `isInternalImagePath`, `Lang`, `serverSupabaseUrl`, `safeError`.
- Produces:
  - `state.ts`:
    - `SWITCH_KEYS = ["giveaways","pay","checker","vouches","approvals","multisend","gas","donate","checkerApi","registration"] as const`;
    - `type SwitchKey = (typeof SWITCH_KEYS)[number]` y `type ToolKey = Exclude<SwitchKey, "registration">`;
    - `type MaintenanceConfig = { enabled: boolean; mode: "default" | "custom"; messageEs: string | null; messageEn: string | null; returnAt: string | null; startsAt: string | null; endsAt: string | null }`;
    - `type SiteState = { switches: Record<SwitchKey, boolean>; maintenance: MaintenanceConfig }`;
    - `OPEN_STATE: SiteState`;
    - `parseSiteState(raw: unknown): SiteState`:
      - solo `false` apaga un interruptor;
      - un `enabled` que no es `true`, o una fecha que no se puede leer → `false` / `null`;
    - `isMaintenanceActive(m: MaintenanceConfig, now: number): boolean` (A-R11);
    - `retryAfterSeconds(m: MaintenanceConfig, now: number): number` (A-R8).
  - `site-state.ts` (sin `server-only`):
    - `getSiteState(opts?: { fetcher?: typeof fetch; now?: number }): Promise<SiteState>` (A-R3);
    - `invalidateSiteState(): void`;
    - `siteStateTtlMs(env = process.env): number` (por defecto 5000; acepta `0`).
  - `paths.ts`:
    - `toolForPath(pathname: string): ToolKey | null`: tabla de A-R9, sobre `toInternalPath(pathname, false)` más `/donar` y `/api/v1/check/*`;
    - `isMaintenanceBypass(pathname: string): boolean` (A-R7, por límites de segmento: `/api/cronx` no pasa);
    - `isStatusPath(pathname: string): boolean` (`/status` y `/status/*`);
    - `statusLang(pathname: string, acceptLanguage: string | null): Lang` (A-R12).
  - `gate.ts`:
    - `type GateInput = { pathname: string; method: string; rsc: boolean; state: SiteState; now: number; access: "superadmin" | "granted" | "none" }`;
    - `type GateDecision = { kind: "pass"; banner: boolean } | { kind: "status404" } | { kind: "maintenancePage" } | { kind: "maintenanceJson" } | { kind: "unavailablePage" } | { kind: "unavailableJson" }`;
    - `gateDecision(i: GateInput): GateDecision`, que evalúa en este orden:
      1. `isStatusPath` → `status404`;
      2. mantenimiento activo, sin bypass y con `access` `"none"` → `maintenancePage` si es `GET`/`HEAD` fuera de `/api/`; si no, `maintenanceJson`;
      3. herramienta apagada → `unavailableJson` si es la API, o `unavailablePage` si es `GET`/`HEAD` y `!rsc`;
      4. si no, `pass` con `banner` = mantenimiento activo ∧ `access ≠ "none"`.

- [ ] **Step 1: Failing tests**
  - `state.test.ts` (**Review Focus 2**):
    - con `endsAt = now` → `false`;
    - `startsAt` en el futuro y `enabled: false` → `false`;
    - `startsAt` pasado sin `endsAt` → `true`;
    - `enabled: true` con `endsAt` pasado → `false`;
    - `retryAfterSeconds` sin `returnAt` → 3600, con `returnAt` a 30 s → 60, a 2 días → 86400 y a 10 min → 600;
    - `parseSiteState({ switches: { gas: false } })` → `gas: false` y las otras nueve `true`;
    - `parseSiteState("x")` → `OPEN_STATE`.
  - `site-state.test.ts` (**Review Focus 1**), con `fetcher` simulado y `vi.useFakeTimers`:
    - dos llamadas seguidas → un solo `fetch` (y la petición lleva `apikey` y la ruta `/rest/v1/rpc/site_state`);
    - pasado el TTL → un segundo `fetch`;
    - con `SITE_STATE_TTL_MS=0`, cada llamada hace `fetch`;
    - tres llamadas simultáneas → un solo `fetch`;
    - un `fetch` que rechaza, un 500 o un JSON roto → `OPEN_STATE`, un solo `console.error` y ningún `fetch` más dentro del TTL;
    - un `fetch` que no responde → `OPEN_STATE` en ≤ 1500 ms (comprueba que se pasa la señal de `AbortSignal.timeout(1500)`).
  - `paths.test.ts`:
    - `/herramientas/gas` y `/en/tools/gas` → `gas`;
    - `/herramientas/sorteos/<uuid>/entries` → `giveaways`;
    - `/pay/tx/84532/0x…` y `/en/pay/ana` → `pay`;
    - `/donar` y `/en/donate` → `donate`;
    - `/herramientas/comprobador/api` y `/api/v1/check/token` → `checkerApi`;
    - `/herramientas/comprobador` → `checker`;
    - `/herramientas`, `/foro/donar` y `/` → null;
    - `isMaintenanceBypass("/api/cron/dao")` → true y `("/api/cronx")` → false;
    - `/api/team-access`, `/robots.txt` y `/es/opengraph-image-1a2b` → true;
    - `/foro/login` → false;
    - `statusLang("/foro/c/x", "en-GB,en;q=0.9")` → `en`, `("/", "en")` → `es` y `("/en/tools", null)` → `en`.
  - `gate.test.ts` (**Review Focus 3**), con el mantenimiento activo:
    - `GET /` anónimo → `maintenancePage`;
    - `POST /herramientas/gas` → `maintenanceJson`;
    - `GET /` con `rsc: true` → `maintenancePage`;
    - `GET /status/es/maintenance` → `status404` aunque haya mantenimiento;
    - `POST /api/cron/dao` → `pass`;
    - `access: "granted"` → `pass` con `banner: true`.

    Sin mantenimiento y con `gas` apagado:
    - `GET /herramientas/gas` → `unavailablePage`;
    - el mismo con `rsc: true` → `pass`;
    - `POST /herramientas/gas` → `pass` (acción en curso, A-R9);
    - `POST /api/v1/check/token` con `checkerApi` apagado → `unavailableJson`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/admin`: FAIL.
- [ ] **Step 3: Implement** los cuatro módulos según Interfaces.
- [ ] **Step 4: Run** `pnpm vitest run tests/unit/admin` y `pnpm typecheck`: PASS.
- [ ] **Step 5: Commit** `feat(admin): estado del sitio con caché corta y decisión de mantenimiento e interruptores`

---

### Task 3: El proxy aplica el mantenimiento y los interruptores

**Files:**
- Create: `src/lib/admin/access.ts`.
- Modify:
  - `src/proxy.ts`;
  - `src/lib/auth/public-paths.ts` (`PUBLIC_PREFIXES` gana `"/api/team-access"`);
  - los cinco tests que importan `@/proxy` (`tests/unit/proxy-public-origin.test.ts`, `tests/unit/i18n/proxy-public-404.test.ts`, `tests/unit/onboarding/proxy-gate.test.ts`, `tests/unit/pay/proxy-alias-404.test.ts` y `tests/unit/start/start-proxy.test.ts`), que ganan `vi.mock("@/lib/admin/site-state", () => ({ getSiteState: async () => OPEN_STATE }))`.
- Test: `tests/unit/admin/proxy-gate.test.ts`, `tests/unit/admin/access.test.ts`, `tests/unit/public-paths.test.ts` (ampliar).

**Interfaces:**
- Consumes: Task 2 (`getSiteState`, `isMaintenanceActive`, `retryAfterSeconds`, `gateDecision`, `statusLang`); `walletFromUser` y `isSuperAdminWallet`.
- Produces:
  - `maintenanceAccess(supabase: Pick<SupabaseClient, "rpc">, user: { id: string; identities?: … }, env = process.env): Promise<"superadmin" | "granted" | "none">`:
    - primero `isSuperAdminWallet(walletFromUser(user), env.SUPER_ADMIN_WALLET)`;
    - luego `rpc("my_maintenance_access")`, donde `listed`, `none` o un error → `"none"`;
    - caché positiva de A-R4;
    - `__resetAccessCache()` para tests.
  - `MAINTENANCE_BANNER_COOKIE = "elclub-mnt"` (exportada desde `access.ts`).
  - Proxy, nuevo paso después de `getUser()` y antes de `decidePublicRoute`:
    - `state = await getSiteState()`;
    - `access` se calcula solo si el mantenimiento está activo y hay `user` (si no, `"none"`);
    - `gateDecision({ pathname, method, rsc: request.headers.get("rsc") === "1", state, now: Date.now(), access })`;
    - cada decisión se traduce a la respuesta de A-R8; el `lang` del rewrite sale de `statusLang(pathname, request.headers.get("accept-language"))`;
    - `status404` usa el `notFound()` que ya existe;
    - todas las respuestas pasan por `applySessionHeaders` y `remember`, como las demás;
    - `pass` con `banner` fija la cookie de A-R15, y `pass` sin `banner` la borra si venía.

- [ ] **Step 1: Failing tests**
  - `proxy-gate.test.ts`, con `getSiteState` simulado y `@supabase/ssr` simulado como en `proxy-public-origin.test.ts`:
    - mantenimiento activo, `GET /herramientas` anónimo → estado 503, `x-middleware-rewrite` termina en `/status/es/maintenance`, `retry-after: 3600`, `cache-control` con `no-store` y `x-robots-tag: noindex`;
    - `GET /en/tools` → `/status/en/maintenance`;
    - `GET /api/v1/check/token` → 503 con JSON `{ error: "maintenance" }`;
    - `POST /api/cron/dao` → no es 503;
    - **Review Focus 3:**
      - cookie `elclub-mnt=1` y cabecera `x-pathname: /api/cron/x` falsas → 503 igual;
      - `GET /status/es/maintenance` directo → 404 con y sin mantenimiento;
    - **Review Focus 4:** con `rpc("my_maintenance_access")` que da error y la wallet de sesión = `SUPER_ADMIN_WALLET` → no es 503 y lleva `set-cookie` con `elclub-mnt=1`;
    - **Review Focus 5:** la RPC devuelve `granted` y luego `none`. Con `SITE_STATE_TTL_MS=0` y el reloj adelantado 5 s, la segunda petición → 503;
    - con `gas` apagado: `GET /herramientas/gas` → 503 con rewrite a `/status/es/unavailable` y sin `retry-after`;
    - con `RSC: 1` → pasa;
    - `checkerApi` apagado → `GET /api/v1/check/link` → 503 con `{ error: "unavailable" }`.
  - `access.test.ts`:
    - un `granted` se guarda (la segunda llamada no llama a `rpc`);
    - un `none` no se guarda;
    - 501 usuarios distintos → la caché se vacía;
    - un `rpc` que lanza → `"none"`.
  - `public-paths.test.ts`: `isPublicPath("/api/team-access")` → true.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/admin tests/unit/proxy-public-origin.test.ts tests/unit/i18n tests/unit/onboarding tests/unit/pay tests/unit/start tests/unit/public-paths.test.ts`: FAIL.
- [ ] **Step 3: Implement** `access.ts`, el paso nuevo del proxy, el prefijo público y los mocks en los cinco tests existentes.
- [ ] **Step 4: Run** los tests del Step 2, `pnpm lint`, `pnpm typecheck` y `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`: PASS. Hasta Task 5, `/status/*` no tiene páginas: el rewrite de los tests unitarios basta.
- [ ] **Step 5: Commit** `feat(admin): el proxy cierra la web en mantenimiento y corta las herramientas apagadas con 503`

---

### Task 4: Acceso del equipo en el servidor — contraseña y `/api/team-access`

**Files:**
- Create: `src/lib/admin/password.ts`, `src/app/api/team-access/route.ts`.
- Modify:
  - `src/lib/rate-limit.ts` (`PreHitBucket` gana `"maintenance_password"`);
  - `src/lib/rate-limit/ip.ts` (`IpBucket` gana `"maintenance_password"`);
  - `src/lib/errors.ts` (`MESSAGES` gana `switch_invalid`, `maintenance_invalid`, `wallet_invalid`, `note_invalid` y `password_invalid`, con su texto en español).
- Test: `tests/unit/admin/password.test.ts`, `tests/unit/admin/team-access-route.test.ts`.

**Interfaces:**
- Consumes: Task 1 (`my_maintenance_access`, `maintenance_password_record`, `grant_maintenance_access`, los buckets), Task 2 (`getSiteState`, `isMaintenanceActive`), `createServerClient`, `createAdminClient`, `hitIpRateLimit` y `hitRateLimit`.
- Produces:
  - `password.ts` (`server-only`):
    - `PASSWORD_MIN = 12`, `PASSWORD_MAX = 128`;
    - `hashPassword(plain: string): Promise<string>` (A-R10);
    - `verifyPassword(plain: string, stored: string): Promise<boolean>`: un formato inválido → `false`; usa `timingSafeEqual`.
  - `POST /api/team-access`, con cuerpo JSON `{ password?: string }`:
    - **Respuestas fijas:**
      - `sec-fetch-site` distinto de `same-origin` → 403 `{ error: "forbidden" }`;
      - sin sesión → 401 `{ status: "not_signed_in" }`;
      - mantenimiento inactivo → `{ status: "off" }`.
    - **Sin `password`:** según `my_maintenance_access`, `{ status: "superadmin" | "granted" | "needs_password" | "not_listed" }`, que sale de `listed` → `needs_password` y `none` → `not_listed`.
    - **Con `password`:**
      1. longitud fuera de 1–128 → 400 `{ status: "invalid" }`;
      2. `hitIpRateLimit("maintenance_password")` y `hitRateLimit(supabase, "maintenance_password")`; cualquiera en `rate_limited` → 429 `{ status: "rate_limited" }`; un `"error"` → 503 `{ status: "error" }` (falla cerrado);
      3. `my_maintenance_access`: `none` → `{ status: "not_listed" }`, y `superadmin` o `granted` → ese estado;
      4. `maintenance_password_record` (admin): si es null → `{ status: "wrong_password" }`;
      5. `verifyPassword`: si falla → `{ status: "wrong_password" }`;
      6. `grant_maintenance_access(user.id, version)` → `{ status: "granted" }`, o `{ status: "wrong_password" }` si da `stale`.
    - Nunca devuelve ni registra la contraseña ni el hash. Los errores se registran con `safeError`.
    - Siempre lleva `Cache-Control: no-store`.

- [ ] **Step 1: Failing tests**
  - `password.test.ts`:
    - ida y vuelta: `verifyPassword("correct horse battery", await hashPassword(...))` → true y otra contraseña → false;
    - dos hashes de la misma contraseña son distintos (sal);
    - el formato cumple el regex de A-R10;
    - un `stored` manipulado (`scrypt$1$...`, base64 roto) → false sin lanzar;
    - se llama a `timingSafeEqual` (`vi.spyOn` sobre `node:crypto`).
  - `team-access-route.test.ts` (clientes simulados):
    - un `sec-fetch-site: cross-site` → 403;
    - sin usuario → 401;
    - mantenimiento apagado → `off`;
    - `listed` sin contraseña → `needs_password`;
    - `rate_limited` → 429 sin leer el hash;
    - `none` con contraseña → `not_listed`, y el golpe se cobra igual;
    - una contraseña mala → `wrong_password` y `grant_maintenance_access` no se llama;
    - la buena → `granted`, con `grant_maintenance_access` llamado con `{ p_auth_user_id: user.id, p_password_version: 3 }`;
    - `stale` → `wrong_password`;
    - ningún `console.*` recibe la contraseña ni el hash (se recorren las llamadas espiadas).
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/admin/password.test.ts tests/unit/admin/team-access-route.test.ts`: FAIL.
- [ ] **Step 3: Implement**, con `scrypt` envuelto en una promesa, y en el handler `await connection()` antes de leer.
- [ ] **Step 4: Run** el unit, `pnpm typecheck` y `pnpm lint`: PASS.
- [ ] **Step 5: Commit** `feat(admin): contraseña de mantenimiento con scrypt y acceso del equipo con intentos limitados`

---

### Task 5: Páginas propias — mantenimiento, no disponible, 404 y franja

**Files:**
- Create:
  - `src/app/status/[lang]/maintenance/page.tsx`;
  - `src/app/status/[lang]/unavailable/page.tsx`;
  - `src/app/not-found.tsx`;
  - `src/components/status/status-shell.tsx`;
  - `src/components/status/status-mark.tsx`;
  - `src/components/status/team-access.tsx` (`"use client"`);
  - `src/components/status/local-time.tsx` (`"use client"`);
  - `src/components/status/maintenance-banner.tsx` (`"use client"`);
  - `src/components/status/not-found-view.tsx`;
  - `src/lib/auth/siwe-sign-in.ts` (cliente).
- Modify:
  - `src/components/public/public-connect.tsx` (pasa a usar `signInWithWallet`, sin cambiar su comportamiento);
  - `src/components/providers.tsx` (monta `MaintenanceBanner`);
  - `src/app/globals.css` (`@keyframes status-drift`);
  - `src/lib/i18n/public-routing.ts` (`APP_TOP_SEGMENTS` gana `"status"`, a la vez que se crea `src/app/status`);
  - diccionarios (sección `status`, A-R20).
- Test:
  - `tests/unit/status/status-pages.test.tsx`;
  - `tests/unit/status/team-access.test.tsx`;
  - `tests/unit/status/not-found.test.tsx`;
  - `tests/unit/status/maintenance-banner.test.tsx`;
  - `tests/unit/public/public-connect.test.tsx` (debe seguir verde);
  - `tests/unit/i18n/app-top-segments.test.ts` (ahora verde).

**Interfaces:**
- Consumes: Task 2 (`getSiteState`, `MaintenanceConfig`), Task 3 (`MAINTENANCE_BANNER_COOKIE`), Task 4 (`POST /api/team-access` y sus `status`), `getDictionary`, `localizedPath` y `clubPath`.
- Produces:
  - `signInWithWallet(input: { address: \`0x${string}\`; chainId: number; lang: Lang; sign: (message: string) => Promise<\`0x${string}\`> }): Promise<{ ok: true } | { ok: false; error: "cancelled" | "verify" }>`: es el cuerpo SIWE de `PublicConnect`, con `buildLoginMessage` y `signInWithWeb3`.
  - `StatusShell({ lang, code: "503" | "404", title, text, children })`:
    - `<main lang>` centrado;
    - `StatusMark` a la izquierda en ≥ `md` y arriba en móvil;
    - el código en JetBrains Mono, en `text-fg-muted`.
  - `StatusMark()`: el cuadrado del logo (`bg-accent`) que deriva despacio en una rejilla de 3×3 cuadrados `border-border-strong`, con `animate-[status-drift_6s_ease-in-out_infinite]` y `motion-reduce:animate-none`. Es `aria-hidden`.
  - Página de mantenimiento:
    - `generateStaticParams` es/en, `instant = false` y `metadata.robots = { index: false, follow: false }`;
    - dentro de `<Suspense>`, tras `await connection()`, `getSiteState()`:
      - el texto por defecto, o el `messageEs`/`messageEn` personalizado, con `white-space: pre-line`;
      - con `returnAt`, `t.returnAt` con `<LocalTime iso lang />`;
    - debajo, `<TeamAccess lang />`.
  - `TeamAccess({ lang })`:
    1. el estado inicial es el botón de texto `t.status.teamAccess`;
    2. al abrirlo, hace `POST /api/team-access` sin contraseña;
    3. con `not_signed_in`, muestra conectar (AppKit) y «Firmar y entrar» (`t.connect.signIn`, el único relleno), y al firmar con `signInWithWallet` vuelve al paso 2;
    4. con `needs_password`, muestra un formulario con `t.status.passwordLabel` (`type="password"`, `autoComplete="current-password"`) y «Entrar»;
    5. con `granted` o `superadmin`, hace `window.location.reload()`;
    6. con `not_listed`, `wrong_password` o `rate_limited`, muestra `role="alert"` con `notListed`, `wrongPassword` o `tooManyAttempts`.

    Los textos de los botones coinciden con los del helper `signInPublic` del e2e.
  - `LocalTime({ iso, lang })`: `<time dateTime={iso}>`. En el servidor sale en UTC y, al montar, en la zona del navegador con `Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" })`.
  - Página «no disponible»: estática (es/en), `noindex`, con `StatusShell code="503"`, `unavailableTitle`, `unavailableText` y el enlace de relleno `seeTools` a `localizedPath(lang, "tools")`.
  - `notFoundVariant(xPathname: string | null): "es" | "en" | "foro"` (A-R14) y `NotFoundView({ variant })`:
    - `es` / `en`: `notFoundTitle` y `notFoundText`, con el relleno `backHome` a `localizedPath(lang, "home")` y un enlace secundario `outline` `seeTools`;
    - `foro`: `notFoundForoTitle` y el relleno `backForo` a `clubPath()`.
  - `src/app/not-found.tsx`: `metadata.robots` noindex; dentro de `<Suspense>`, `notFoundVariant((await headers()).get("x-pathname"))`.
  - `MaintenanceBanner()`:
    - lee `document.cookie` al montar y cuando cambia `usePathname()`;
    - con `elclub-mnt=1`, pinta una franja fija arriba (`role="status"`, `bg-surface-2`, borde inferior `border-accent`) con `banner`, en `en` si la ruta empieza por `/en` y en `es` si no;
    - la página reserva su altura con `padding-top` en `body` mientras se ve.

- [ ] **Step 1: `ui-ux-pro-max`** para la familia de páginas de error y de estado: sobria y oscura, con un único elemento gráfico animado del cuadrado del logo, jerarquía código → título → texto → acción, el botón discreto de equipo y la franja fija que no tape el contenido a 375 px.
- [ ] **Step 2: Failing tests**
  - `status-pages.test.tsx`:
    - el mantenimiento por defecto en ES muestra `maintenanceTitle` y `maintenanceText`, y en EN no tiene cadenas ES;
    - el personalizado muestra `messageEn` en `/status/en` y la línea `Estimated return:` con un `<time dateTime>` igual a `returnAt`;
    - ningún elemento `bg-accent-fill` antes de abrir «Acceso del equipo»;
    - la metadata de las dos páginas lleva `robots.index === false`;
    - «no disponible» en ES enlaza `seeTools` a `/herramientas` y en EN a `/en/tools`, con exactamente un `bg-accent-fill`.
  - `team-access.test.tsx` (`fetch` simulado):
    - `needs_password` muestra el campo de contraseña;
    - enviar → `POST` con `{ password }`;
    - `wrong_password` → alerta «Contraseña incorrecta.» y no recarga;
    - `granted` → `location.reload` llamado;
    - `not_listed` → `notListed`;
    - `rate_limited` → `tooManyAttempts`;
    - `not_signed_in` muestra «Firmar y entrar».
  - `not-found.test.tsx`:
    - `notFoundVariant("/en/x")` → `en`, `("/foro/c/x")` → `foro`, `("/x")` y `(null)` → `es`;
    - la vista `foro` enlaza «Volver al foro» a `/foro`;
    - la vista `en` enlaza «Back to home» a `/en`;
    - un solo `bg-accent-fill` en cada variante.
  - `maintenance-banner.test.tsx`:
    - con `document.cookie = "elclub-mnt=1"` muestra el texto ES en `/herramientas` y el EN en `/en/tools`;
    - sin la cookie no pinta nada.
- [ ] **Step 3: Run** `pnpm vitest run tests/unit/status tests/unit/public/public-connect.test.tsx tests/unit/i18n`: FAIL.
- [ ] **Step 4: Implement** según Interfaces y A-R17 / A-R20.
- [ ] **Step 5: Run** los tests del Step 3, `pnpm lint`, `pnpm typecheck` y `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`: PASS.
- [ ] **Step 6: Commit** `feat(status): páginas propias de mantenimiento, herramienta no disponible y 404, con acceso del equipo y franja`

---

### Task 6: Pestaña «Administración»

**Files:**
- Create:
  - `src/app/foro/(forum)/settings/administracion/page.tsx`;
  - `src/lib/admin/actions.ts` (`"use server"`);
  - `src/lib/admin/overview.ts` (`server-only`);
  - `src/lib/admin/labels.ts`;
  - `src/components/admin/tool-switches.tsx` (`"use client"`);
  - `src/components/admin/maintenance-form.tsx` (`"use client"`);
  - `src/components/admin/access-list.tsx` (`"use client"`);
  - `src/components/admin/admin-history.tsx`.
- Modify: `src/lib/permissions/settings.ts` (tras «Economía», `{ href: clubPath("/settings/administracion"), label: "Administración" }` con el mismo bit en bruto).
- Test:
  - `tests/unit/admin/actions.test.ts`;
  - `tests/unit/admin/labels.test.ts`;
  - `tests/unit/admin/maintenance-form.test.tsx`;
  - `tests/unit/admin/tool-switches.test.tsx`;
  - `tests/unit/admin/access-list.test.tsx`;
  - `tests/unit/settings/guard.test.ts` (ampliar);
  - `tests/unit/permissions.test.ts` (ampliar con `settingsSections`).

**Interfaces:**
- Consumes: Task 1 (RPCs `admin_*`), Task 2 (`SwitchKey`, `MaintenanceConfig`, `invalidateSiteState`), Task 4 (`hashPassword`, `PASSWORD_MIN` / `PASSWORD_MAX`, códigos de error), `rpcErrorCode`, `AlertDialog`, `Button`, `Input`, `Label`.
- Produces:
  - `overview.ts`: `type AdminOverview = { switches: Record<SwitchKey, boolean>; maintenance: MaintenanceConfig; passwordSet: boolean; passwordUpdatedAt: string | null; accessList: Array<{ wallet: string; note: string | null; createdAt: string }>; history: Array<{ at: string; actor: string; action: string; payload: Record<string, unknown> }> }` y `getAdminOverview(): Promise<AdminOverview>`, que lanza si la RPC falla.
  - `actions.ts`, donde cada acción devuelve `{ ok: true } | { ok: false; error: string }`, valida la forma antes de la RPC (si no, `invalid_input`) y, si sale bien, hace `invalidateSiteState()` y `revalidatePath(clubPath("/settings/administracion"))`:
    - `setSwitchAction(key: SwitchKey, enabled: boolean)`;
    - `setMaintenanceAction(input: { enabled: boolean; mode: "default" | "custom"; messageEs?: string; messageEn?: string; returnAt?: string | null; startsAt?: string | null; endsAt?: string | null })` (en `default` envía null en todo lo demás);
    - `setMaintenancePasswordAction(password: string)` (fuera de 12–128 → `password_invalid` sin llamar a la RPC; si no, hashea y llama);
    - `addAccessWalletAction(wallet: string, note: string)`;
    - `removeAccessWalletAction(wallet: string)`.
  - `labels.ts`:
    - `SWITCH_LABELS: Record<SwitchKey, string>`, con los textos de la tabla del spec («Sorteos verificables», «ElClub Pay», «Comprobador», «Avales», «Aprobaciones», «Envío múltiple (incluye «Repartir gastos»)», «Gas», «Donar público», «API del comprobador», «Registro de cuentas públicas»);
    - `describeAdminAction(action: string, payload: Record<string, unknown>): string`:
      - «Desactivó «Gas»» y «Activó «Gas»»;
      - «Activó el mantenimiento», «Programó el mantenimiento» (con `startsAt` y sin `enabled`) y «Desactivó el mantenimiento»;
      - «Cambió la contraseña de mantenimiento»;
      - «Añadió 0x1234…abcd a la lista de acceso» y «Quitó 0x1234…abcd de la lista de acceso»;
      - una acción desconocida → el código.
  - Página (patrón de `economia/page.tsx`):
    - `<Suspense>`; el bit 512 en bruto o `notFound()`;
    - `getAdminOverview()`;
    - cuatro secciones con `h3`: «Herramientas y funciones públicas», «Mantenimiento», «Lista de acceso» e «Historial».
  - `ToolSwitches({ switches })`: un `role="switch"` por clave, con `aria-checked`. Apagar abre un `AlertDialog` («¿Desactivar «{label}»? Los visitantes verán «No disponible» hasta que lo actives.»); encender no.
  - `MaintenanceForm({ maintenance, passwordSet })`:
    - **estado:** «Activo ahora», «Programado» o «Apagado», con `isMaintenanceActive`;
    - **modalidad:** radios «Por defecto» y «Personalizado»;
    - **en «Personalizado»:**
      - dos `textarea` («Mensaje en español», «Mensaje en inglés») de hasta 500 caracteres;
      - tres `datetime-local` («Vuelta estimada», «Empieza», «Termina»), convertidos a ISO UTC en el navegador con `new Date(local).toISOString()` y precargados con la hora local de lo guardado;
    - **casilla** «Activar ahora»;
    - **«Guardar mantenimiento»**, el único relleno de la pestaña. Si el resultado queda activo o programado, pide confirmación («La web se cerrará al público. Tú seguirás entrando.»). Hay además un botón `outline` «Desactivar mantenimiento»;
    - **contraseña:** «Contraseña de mantenimiento», un `type="password"` con «Guardar contraseña» y el texto «Fijada el {fecha}» o «Sin fijar»;
    - **sin `passwordSet`:** el aviso «Sin contraseña, solo tú podrás entrar.».
  - `AccessList({ items })`:
    - formulario «Wallet» + «Nota (opcional)» → «Añadir»;
    - lista con la dirección corta, la nota y «Quitar» (`outline`);
    - una dirección inválida → el error de `wallet_invalid` sin llamar a la acción. La validación usa `/^0x[0-9a-fA-F]{40}$/`.
  - `AdminHistory({ history })`: `<ol>` con `<time>`, el actor y `describeAdminAction`. Sin historial → «Todavía no hay cambios.».

- [ ] **Step 1: `ui-ux-pro-max`** para una pestaña de administración densa pero legible: interruptores con estado en texto (no solo color), un formulario con estados claros (activo, programado o apagado), el aviso de riesgo sin alarmismo y la tabla de la lista apilada a 375 px.
- [ ] **Step 2: Failing tests**
  - `actions.test.ts` (RPC simulada):
    - `setSwitchAction("nope" as never, false)` → `invalid_input` sin RPC;
    - `setSwitchAction("gas", false)` → `rpc("admin_set_switch", { p_key: "gas", p_enabled: false })` e `invalidateSiteState` llamado;
    - `setMaintenanceAction({ enabled: true, mode: "default", messageEs: "x" })` → `p_message_es: null`;
    - `setMaintenancePasswordAction("short")` → `password_invalid` sin RPC;
    - la contraseña buena → la RPC recibe un `p_hash` que empieza por `scrypt$` y no contiene la contraseña;
    - `forbidden` de la RPC → `{ ok: false, error: "forbidden" }`.
  - `labels.test.ts`: cada fila de `describeAdminAction` de Interfaces; las 10 claves de `SWITCH_LABELS`.
  - `tool-switches.test.tsx`:
    - apagar «Gas» abre la confirmación y, sin «Confirmar», no llama a la acción;
    - con «Confirmar» → `setSwitchAction("gas", false)`;
    - encender no pide confirmación.
  - `maintenance-form.test.tsx`:
    - **Review Focus 2:** con `TZ=Europe/Madrid` (`process.env.TZ`), «Empieza» = `2026-11-01T10:00` → la acción recibe `startsAt: "2026-11-01T09:00:00.000Z"`;
    - «Por defecto» oculta los mensajes y las fechas;
    - activar pide confirmación;
    - **Review Focus 4:** con `passwordSet: false` muestra «Sin contraseña, solo tú podrás entrar.»;
    - exactamente un `bg-accent-fill` en la pestaña montada (`ToolSwitches`, `MaintenanceForm`, `AccessList` y `AdminHistory` juntas).
  - `access-list.test.tsx`: `0x12` → error sin llamar a la acción; añadir con nota → `addAccessWalletAction("0x…", "Ana — moderadora")`; «Quitar» → `removeAccessWalletAction`.
  - `guard.test.ts` / `permissions.test.ts`:
    - `settingsSections(512n)` incluye «Administración» → `/foro/settings/administracion`;
    - `settingsSections(Perm.MANAGE_ROLES)` no la incluye;
    - `isHiddenSettingsPage` da 404 a un miembro activo sin el bit en `/foro/settings/administracion`.
- [ ] **Step 3: Run** `pnpm vitest run tests/unit/admin tests/unit/settings tests/unit/permissions.test.ts`: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** los tests del Step 3, `pnpm lint`, `pnpm typecheck` y `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`: PASS.
- [ ] **Step 6: Commit** `feat(admin): pestaña Administración con interruptores, mantenimiento, lista de acceso e historial`

---

### Task 7: Registro de cuentas públicas cerrable

**Files:**
- Create: `src/lib/admin/registration.ts` (`server-only`), `src/lib/admin/registration-actions.ts` (`"use server"`).
- Modify:
  - `src/lib/auth/actions.ts` (`completeLogin`, modo `public`);
  - `src/components/public/public-connect.tsx`;
  - diccionarios (`connect.errRegistrationClosed`).
- Test:
  - `tests/unit/admin/registration.test.ts`;
  - `tests/unit/complete-login.test.ts` (ampliar);
  - `tests/unit/public/public-connect.test.tsx` (ampliar).

**Interfaces:**
- Consumes: Task 1 (`my_registration_blocked`), Task 5 (`signInWithWallet`), `createAdminClient` y `createServerClient`.
- Produces:
  - `enforcePublicRegistration(supabase: SupabaseClient, userId: string): Promise<"ok" | "closed">`:
    - con `rpc("my_registration_blocked")` en `true`: `createAdminClient().auth.admin.deleteUser(userId)`, después `supabase.auth.signOut()`, y devuelve `"closed"`;
    - un error de la RPC → `"ok"` (fail-open, registrado con `safeError`).
  - `publicRegistrationGate(): Promise<{ ok: true } | { ok: false; error: "registration_closed" }>`: sin usuario → `{ ok: true }`; con estado `none` llama a `enforcePublicRegistration`.
  - `completeLogin(_, "public")`: con estado `none` y `enforcePublicRegistration` en `"closed"` → `{ redirectTo: "public", error: "registration_closed" }`.
  - `PublicConnect`:
    - tras firmar con éxito, llama a `publicRegistrationGate()` antes de navegar;
    - con `registration_closed`, hace `createBrowserClient().auth.signOut({ scope: "local" })`, muestra `connect.errRegistrationClosed` en `role="alert"` y no navega.

- [ ] **Step 1: Failing tests**
  - `registration.test.ts`:
    - `blocked = true` → `deleteUser(userId)` y `signOut` llamados, y devuelve `"closed"`;
    - `false` → ninguno de los dos;
    - un error de la RPC → `"ok"` y un `console.error` sin datos de usuario.
  - `complete-login.test.ts`:
    - público con estado `none` y registro cerrado → `error: "registration_closed"`;
    - un miembro activo o el arranque del SuperAdmin no llaman a `my_registration_blocked`;
    - el modo club con invitación sigue canjeando.
  - `public-connect.test.tsx`: con la puerta en `registration_closed` → el texto «El registro de cuentas está cerrado ahora.», sin `hardNavigate` y con `signOut` local; con `ok` → navega como antes.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/admin/registration.test.ts tests/unit/complete-login.test.ts tests/unit/public/public-connect.test.tsx`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** el unit de Step 2, `pnpm typecheck` y `pnpm lint`: PASS.
- [ ] **Step 5: Commit** `feat(admin): cerrar el registro de cuentas públicas sin afectar a las existentes ni a las invitaciones`

---

### Task 8: Hub y landing según los interruptores, e2e, capturas, verificación y docs

**Files:**
- Modify:
  - `src/components/public/tool-card.tsx` (prop `dimmed?: boolean`);
  - `src/app/(public)/[lang]/tools/page.tsx`;
  - `src/app/(public)/[lang]/page.tsx`;
  - `src/components/landing/landing.tsx`, `src/components/landing/hero.tsx` y `src/components/landing/final-cta.tsx` (prop `off`);
  - diccionarios (`tools.unavailableNow`);
  - `playwright.config.ts` (`SITE_STATE_TTL_MS: "0"`);
  - el spec (sección «Hecho»).
- Create:
  - `src/components/public/tool-grid.tsx`;
  - `src/components/landing/landing-live.tsx`;
  - `e2e/admin-maintenance.spec.ts`.
- Test: `tests/unit/public/tools-hub.test.tsx` y `tests/unit/landing/landing.test.tsx` (pasan a usar `ToolGrid` y `Landing` con `off`).

**Interfaces:**
- Consumes: Task 2 (`getSiteState`, `ToolKey`), Task 3 a Task 7 (todo el flujo).
- Produces:
  - `ToolGrid({ lang, off }: { lang: Lang; off: ReadonlySet<ToolKey> })`: las siete tarjetas actuales. Una tarjeta apagada → `ToolCard` sin `href`, con `dimmed` y `status = t.unavailableNow`.
  - `ToolGridLive({ lang })`: async, con `await connection()` y `getSiteState()`; `off` = las claves con `false`.
  - El hub monta `<Suspense fallback={<ul aria-label={t.listLabel} className="min-h-96" />}><ToolGridLive lang /></Suspense>`.
  - `Landing({ lang, off })` con las reglas de A-R16; `LandingLive({ lang })` es análogo a `ToolGridLive`. La página `[lang]/page.tsx` monta `<Suspense fallback={<main className="flex-1" aria-busy="true" />}><LandingLive lang /></Suspense>`.

- [ ] **Step 1: `ui-ux-pro-max`** para la tarjeta atenuada: el estado debe leerse en texto, con contraste AA en la etiqueta aunque la tarjeta esté atenuada (la opacidad va en el icono y el texto secundario, no en la etiqueta), y sin aspecto de enlace.
- [ ] **Step 2: Failing tests**
  - `tools-hub.test.tsx`:
    - los tests actuales pasan a `ToolGrid` con `off` vacío;
    - con `off = {gas}` → no hay enlace «Gas calculator», la tarjeta muestra «Not available right now», las otras seis siguen enlazadas y hay 6 «Available»;
    - en ES, «No disponible ahora».
  - `landing.test.tsx`:
    - con `off = {vouches}` → ningún enlace a `/herramientas/avales`;
    - con `off = {giveaways}` → ningún enlace a `/herramientas/sorteos/nuevo` y 0 `bg-accent-fill`;
    - con `off = {approvals, multisend}` el teaser «Más herramientas» sigue, y con `gas` también apagado desaparece;
    - con `off` vacío, igual que ahora.
- [ ] **Step 3: Run** `pnpm vitest run tests/unit/public tests/unit/landing`: FAIL → **Implement** → PASS.
- [ ] **Step 4: e2e `e2e/admin-maintenance.spec.ts`**, en serie:
  - **Contexto:**
    - `SITE_STATE_TTL_MS=0` en el entorno del servidor;
    - el SuperAdmin entra con `loginAs(E2E_SUPER_ADMIN_PK)` en su contexto antes de cualquier mantenimiento;
    - el `afterAll` (y un `beforeAll` defensivo) restaura con el cliente de `service_role`: `app_config.site_switches` y `maintenance` a los valores de A-R1, y borra `maintenance_access_wallets`, `maintenance_password`, `maintenance_grants` y `registration_holds`.
  1. **Interruptor:**
     - el SuperAdmin abre `/foro/settings/administracion`, apaga «Gas» y confirma;
     - el historial muestra «Desactivó «Gas»»;
     - un anónimo ve en `/herramientas` la tarjeta de Gas con «No disponible ahora» y sin enlace;
     - `/herramientas/gas` responde 503 con «Esta herramienta no está disponible ahora» y el enlace «Ver herramientas» a `/herramientas`;
     - `/en/tools/gas` responde 503 con el texto EN.
  2. **Landing:** con «Avales» apagado, la landing (`/`) no tiene ningún enlace a `/herramientas/avales`.
  3. **API:** con «API del comprobador» apagado, `GET /api/v1/check/token?chain=84532&address=<USDC>` responde 503 `{ "error": "unavailable" }` sin la cabecera `payment-required`. Después se vuelve a encender todo desde la pestaña.
  4. **Registro cerrado:**
     - con el registro apagado, una wallet de Hardhat sin cuenta (`installTestWallet` + `signInPublic` en la cabecera) ve «El registro de cuentas está cerrado ahora.»;
     - con el cliente de `service_role`, `auth.admin.listUsers()` no tiene ningún usuario con una identidad `web3` de esa wallet;
     - se vuelve a encender.
  5. **Mantenimiento:**
     - el SuperAdmin fija la contraseña `"correct horse battery"`;
     - añade la wallet L (Hardhat 12) con la nota «Equipo e2e»;
     - activa el mantenimiento por defecto y confirma.
  6. **Anónimo:**
     - `/` responde 503, con `retry-after: 3600`, `x-robots-tag: noindex` y «Volvemos enseguida»;
     - `/en` responde 503 con «Back shortly»;
     - `GET /api/v1/check/token` responde 503 `{ error: "maintenance" }`.
  7. **Crons:** `POST /api/cron/dao` con `Bearer e2e-cron-secret` responde 200.
  8. **Wallet fuera de la lista** (Hardhat 13): en `/herramientas`, «Acceso del equipo» → `signInPublic(page, teamRegion)` → «Esta wallet no tiene acceso durante el mantenimiento.», y al recargar sigue el 503.
  9. **Wallet L:**
     - mismo flujo → aparece el campo de contraseña;
     - «otra contraseña» → «Contraseña incorrecta.» y sigue el 503;
     - la buena → recarga → 200, con el contenido de `/herramientas` y la franja «Mantenimiento activo: la web está cerrada al público».
  10. **SuperAdmin:** su contexto (solo firmó) abre `/herramientas` → 200 con la franja.
  11. **Revocación:** el SuperAdmin quita L → la siguiente carga de L responde 503.
  12. **Personalizado:**
      - mensajes «Volvemos a las 18:00 con novedades» y «Back at 6pm with news», con `returnAt` a +2 h;
      - un anónimo en `/en` ve el mensaje EN y «Estimated return:»;
      - `retry-after` está entre 7100 y 7200.
  13. **Programado:** `startsAt` −1 min y `endsAt` +1 h con «Activar ahora» desmarcado → sigue el 503. Con `endsAt` pasado no se puede guardar: comprueba el error de `maintenance_invalid`.
  14. **Desactivar:** el SuperAdmin pulsa «Desactivar mantenimiento» → el anónimo recibe 200 en `/` y no hay franja.
  15. **404:**
      - `/no-existe-nada` → 404 con «Aquí no hay nada» y «Volver al inicio» → `/`;
      - `/en/nothing/here` → 404 con «Nothing here»;
      - el SuperAdmin en `/foro/no-existe` → «Este rincón del foro no existe» con «Volver al foro»;
      - las tres llevan `<meta name="robots" content="noindex">`.
  16. Sin errores de consola ni violaciones de CSP (`watchCsp`) en las páginas de estado.
- [ ] **Step 5: Capturas** a 375 y 1440 px en `C:\Users\rayel\AppData\Local\Temp\claude\C--Users-rayel-Desktop-Proyectos-elclublambo\6a23b0f8-b333-4a1a-a087-8dff93986039\scratchpad\admin-shots`:
  - mantenimiento por defecto y personalizado, con el panel de equipo abierto en el paso de la contraseña;
  - «no disponible» en ES y en EN;
  - 404 en ES, EN y foro;
  - la franja sobre `/herramientas`;
  - el hub con una tarjeta atenuada;
  - la pestaña Administración completa.

  En cada una se revisa:
  - un solo relleno Base Blue;
  - ningún scroll horizontal (`document.documentElement.scrollWidth <= innerWidth`);
  - el foco visible;
  - la animación detenida con `reducedMotion: "reduce"`.
- [ ] **Step 6: Verificación completa** (todo en verde o documentado):
  - `pnpm lint`;
  - `pnpm typecheck`;
  - `pnpm test`;
  - `pnpm db:test`;
  - `pnpm test:e2e`;
  - `E2E_PROD=1 pnpm test:e2e`;
  - **`SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`**.
- [ ] **Step 7: Docs:** el spec gana una sección **«Hecho»** con:
  - lo construido, por objetivos 1–5;
  - los rulings A-R1…A-R20 en una línea cada uno;
  - las rutas internas (`/status/[lang]/…` y `/api/team-access`);
  - el punto HACER A MANO: «En PRE: fijar la contraseña de mantenimiento, añadir una wallet del equipo, activar el mantenimiento 5 minutos y comprobar que el cron de Vercel (`/api/cron/dao`) sigue respondiendo; apagar y encender una herramienta y ver el hub».
- [ ] **Step 8: Commit** `feat(admin): hub y landing según los interruptores; e2e de mantenimiento, interruptores y 404; docs`
