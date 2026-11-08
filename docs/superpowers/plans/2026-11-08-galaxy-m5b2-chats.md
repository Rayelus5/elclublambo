# Galaxy M5b-2 · Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un chat global («Comunidad») y el chat de cada clan, en tiempo real, con las reglas de moderación del GDD: nivel mínimo para escribir, límite por minuto, filtro de palabras editable, denuncias y moderadores que borran y silencian.

**Architecture:**
- **Mensajes:**
  - Se guardan en `galaxy.chat_messages` (canal `global` o `clan:<id>`).
  - Se envían con `POST` (fácil de limitar, probar y validar).
  - El servidor los reparte en tiempo real por un WebSocket (`@fastify/websocket` 11). El socket solo empuja: no recibe mensajes de chat.
  - Al abrirse, comprueba la sesión por su cookie y el `Origin` contra `GALAXY_PUBLIC_ORIGINS`, y se suscribe a «Comunidad» y al canal de su clan.
  - El reparto vive en memoria del proceso: PRE y la beta corren un solo contenedor.
- **Moderación:**
  - nivel de cuenta ≥ `chat.minLevel` (5) para escribir;
  - un límite de mensajes por minuto;
  - el filtro de palabras de la configuración viva (`chat.words`) tapa cada palabra con asteriscos;
  - las denuncias, una por cuenta y mensaje; con `chat.hideAfter` (3) el mensaje se oculta solo;
  - `galaxy.chat_mutes` silencia una cuenta hasta una fecha;
  - los roles `moderator`, `admin` y `superadmin` (los de `galaxy.account_roles`) borran mensajes y silencian desde el propio chat. El panel completo llega con M6.
- **La web:** un panel lateral que abre el botón «Comunidad» de la barra superior, con las pestañas Comunidad y Clan. El canal del clan también se abre desde la página del clan.

**Tech Stack:**
- pnpm workspace `games/galaxy`: `@galaxy/shared` (Zod), `@galaxy/server` (Fastify 5, `@fastify/websocket`, Kysely y Postgres) y `@galaxy/web` (React 19, RR7 y TanStack Query 5);
- migraciones y pgTAP;
- Playwright.

**Spec:** `games/galaxy/docs/GDD.md` §14.4:
- «Canales: chat global («Comunidad») y chat de clan»;
- «Moderación: límite de mensajes por minuto; nivel de cuenta mínimo para escribir (de partida: 5); filtro de palabras editable por el admin; botón de denunciar; el admin puede ver y borrar mensajes, silenciar y banear»;
- «Técnica: WebSocket servido por el contenedor galaxy (§18.1)».

§14.3: «Qué hacen: chat entre miembros».

## Global Constraints

- TDD estricto.
- Nada de lo enviado se pinta como HTML: React escapa el texto y el servidor guarda texto plano recortado.
- **El WebSocket:**
  - solo con sesión y desde un origen permitido;
  - nunca reparte un mensaje de clan a quien no es de ese clan;
  - corta a un cliente lento en vez de acumularle mensajes sin fin.
- Copy en español, títulos directos sin símbolos especiales ni punto final. Cada error nuevo tiene su texto.
- ui-ux-pro-max antes del CSS, `DESIGN_SYSTEM.md` §8 terdecies, y movimiento quieto con `prefers-reduced-motion`.
- La BD local es del usuario: `migration up` y `test db`. Los e2e solo escriben cuentas `e2e_*`.
- Commits en español, convencionales, con las líneas de coautoría.

## Review Focus

1. **Escribir sin nivel, silenciado, pasado del límite, en un clan ajeno o vacío:** 403 `chat_level`, 403 `chat_muted`, 429 `rate_limited`, 403 `clan_forbidden` y 400. Nada se guarda ni se reparte → Tarea 3.
2. **El socket:**
   - sin sesión o con otro `Origin`, se cierra;
   - salir de un clan deja de recibir su canal (la suscripción se recalcula en cada reparto, no solo al conectar);
   - un mensaje borrado llega como `deleted` a todos → Tarea 3.
3. **Denuncias:**
   - la propia y la repetida no cuentan;
   - con 3 de cuentas distintas el mensaje se oculta y se reparte `deleted`;
   - el historial no lo trae → Tarea 3.
4. **Moderadores:**
   - un jugador sin rol no borra ni silencia (403 forbidden);
   - silenciar tiene duración y motivo, y caduca → Tarea 3.
5. **La web:**
   - el panel sin nivel dice «Necesitas nivel 5 para escribir»;
   - el contador de caracteres funciona;
   - al reconectar, el historial se vuelve a pedir sin duplicar mensajes;
   - sin clan no hay pestaña Clan → Tarea 5.

---

### Task 1: Reglas, configuración y API

**Files:**
- Create: `games/galaxy/packages/shared/src/chat/rules.ts`, `games/galaxy/packages/shared/src/api/chat.ts`, `games/galaxy/packages/shared/test/chat.test.ts`
- Modify: `registry.ts` (clave `chat`), `errors.ts`, `index.ts`, `copy/es.ts` (errores)

**Interfaces:**
- Produces:
  - **clave viva `chat`:** `{ minLevel: 5, perMinute: 6, maxLength: 280, history: 50, hideAfter: 3, words: [] (hasta 500 palabras de 2 a 40 letras) }`;
  - **reglas:**
    - `maskWords(body, words): string` tapa cada palabra entera con asteriscos, sin distinguir mayúsculas ni tildes, y conserva la longitud;
    - `cleanBody(raw, max): string | null` recorta, junta los espacios seguidos, quita los caracteres de control y devuelve null si queda vacío o es demasiado largo;
  - **tipos:**
    - `ChatChannel = 'global' | 'clan'`;
    - `ChatMessage { id: string; channel; author: { username; level; clan: string | null }; body; at }`;
    - `ChatHistory { channel, messages, canWrite: boolean, reason: 'level' | 'muted' | null, mutedUntil?: string }`;
    - `ChatEvent = { type: 'message'; message } | { type: 'deleted'; channel; id }`;
  - **esquemas:** `chatSendSchema ({ body })`, `chatChannelParamSchema`, `chatReportSchema ({ reason?: ≤ 140 })` y `chatMuteSchema ({ username, minutes: 1–43200, reason: 1–140 })`;
  - **errores:** `chat_level`, `chat_muted`, `chat_empty` y `message_not_found`.

- [ ] **Step 1:** pruebas que fallan:
  - `maskWords` tapa «tonto» en «Eres TONTO», en «tontó» y en «tonto,», pero no dentro de «tontolaba»;
  - `cleanBody` junta espacios, quita los caracteres de control y rechaza lo vacío y lo de más de 280;
  - el registro rechaza 501 palabras;
  - los esquemas.
- [ ] **Step 2 a 5:** FAIL → implementar → PASS → commit `feat(galaxy): reglas, configuración y API de los chats`.

### Task 2: Migración y pgTAP

**Files:** `supabase/migrations/<UTC>_galaxy_chat.sql`, `supabase/tests/983_galaxy_chat.test.sql`, `schema.ts`.

**Interfaces:**
- Produces:
  - `galaxy.chat_messages (id bigint identity pk, channel text check (channel = 'global' or channel ~ '^clan:[0-9a-f-]{36}$'), author_id uuid references accounts on delete cascade, body text check (length between 1 and 280), created_at, hidden_at, hidden_by uuid null, hidden_reason text check in ('moderator','reports'))`, con índice `(channel, id desc) where hidden_at is null`;
  - `galaxy.chat_reports (message_id, reporter_id, reason, created_at, pk (message_id, reporter_id))`;
  - `galaxy.chat_mutes (account_id pk, until, reason, by_id, created_at)`;
  - para `galaxy_api`: select, insert y update en los mensajes, y nunca delete (se ocultan); RLS.

- [ ] pgTAP (las tablas, los `check`s, la clave de denuncias y los permisos) → FAIL → migración → PASS → commit `feat(galaxy): mensajes, denuncias y silencios del chat`.

### Task 3: Servidor

**Files:**
- Create: `games/galaxy/apps/server/src/chat/{service,hub,routes}.ts`, `games/galaxy/apps/server/test/integration/chat.test.ts`
- Modify: `app.ts` (registrar `@fastify/websocket` y las rutas), `security/headers.ts` (si `connect-src 'self'` no basta para `wss:` del mismo origen, añadir el origen público con `wss:`), `package.json` (`@fastify/websocket` 11.3.7).

**Interfaces:**
- Produces:
  - `GET /galaxy/api/chat/:channel?before=` → `ChatHistory` (los últimos `history`, sin ocultos);
  - `POST /galaxy/api/chat/:channel/messages { body }` → `ChatMessage`: nivel, silencio, límite (`rate_limited`), filtro y clan; reparte el mensaje;
  - `POST /galaxy/api/chat/messages/:id/report { reason? }` → `{ hidden: boolean }`;
  - `POST /galaxy/api/chat/messages/:id/hide` (moderador) y `POST /galaxy/api/chat/mutes { username, minutes, reason }` (moderador);
  - el socket `GET /galaxy/api/chat/ws`:
    - eventos `ChatEvent` en JSON y un `ping` cada 25 s;
    - suscripción calculada en cada reparto: el canal global para todos, y el de un clan para sus miembros de ese momento;
    - un cliente con más de 1 MB pendiente se cierra.

- [ ] **Step 1:** integración, una prueba por cada punto de la Review Focus de servidor. El socket se prueba con `app.injectWS`:
  - recibe el mensaje de su canal y no el de otro clan;
  - tras salir del clan, deja de recibirlo;
  - un oculto llega como `deleted`;
  - sin sesión o con otro origen, se cierra.
- [ ] **Step 2 a 5:** FAIL → implementar → PASS (toda la integración en verde) → commit `feat(galaxy): chats en tiempo real con moderación`.

### Task 4: Web

**Files:**
- Create: `games/galaxy/apps/web/src/chat/{ChatPanel,ChatMessageItem,useChatSocket}.tsx`, `games/galaxy/apps/web/src/api/chat.ts`, `games/galaxy/apps/web/test/chat.test.tsx`
- Modify: `hub/TopBar.tsx` (el botón «Comunidad» abre el panel), `clans/ClanScreen.tsx` («Chat del clan»), `App.tsx` o `shell/` (el panel vive por encima de las pantallas), `copy/es.ts`, `styles/app.css`, `DESIGN_SYSTEM.md` §8 terdecies.

- [ ] **Step 1:** pruebas que fallan:
  - **el panel:** es un `dialog` no modal, una «hoja» lateral con su título;
  - **las pestañas:** Comunidad y Clan, y la de Clan solo con clan;
  - **el historial:** los mensajes enseñan autor (con enlace al perfil), nivel, etiqueta de clan y hora;
  - **escribir:**
    - campo con contador «12 de 280»;
    - Enter envía y Mayúsculas+Enter salta de línea;
    - sin nivel, el campo está desactivado y dice «Necesitas nivel 5 para escribir»;
    - silenciado, dice hasta cuándo;
    - un error de límite dice «Vas muy deprisa. Espera un poco»;
  - **lo que llega:** un evento `message` del socket (simulado) se añade sin duplicar, y `deleted` quita el mensaje;
  - **cada mensaje:**
    - «Denunciar», que pide confirmación y dice «Denunciado»;
    - para moderadores, «Ocultar» y «Silenciar 1 hora».
- [ ] **Step 2 a 5:** FAIL → implementar con ui-ux-pro-max → PASS, capturas → commit `feat(galaxy): el panel de chat con Comunidad y Clan`.

### Task 5: e2e, documentación, verificación, revisión, PR y PRE

- [ ] **e2e** (`chat.spec.ts`):
  - dos cuentas de nivel 5 (experiencia en sus filas) abren «Comunidad»;
  - una escribe y la otra lo ve llegar sin recargar;
  - la segunda lo denuncia;
  - una cuenta de nivel 1 ve el campo desactivado con su razón;
  - sin violaciones de CSP (también para el `wss:`).
- [ ] **DEPLOY_PRE paso 16:** la migración, la clave `chat` y comprobar que el túnel de Cloudflare deja pasar el WebSocket.
- [ ] **Verificación completa, revisión (opus), una pasada de correcciones, PR, CI, fusión, PRE, registro y memoria.**
