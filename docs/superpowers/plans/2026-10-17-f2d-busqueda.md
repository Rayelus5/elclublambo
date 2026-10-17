# F2d — Búsqueda Cmd+K · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una paleta Cmd+K (Ctrl+K en Windows) que busca en un solo sitio:
- canales y foros visibles;
- miembros, por nombre o wallet;
- el texto completo de los mensajes, respetando los permisos;
- acciones: crear invitación, ajustes, mis menciones, mis tickets, abrir ticket, cola de reportes, miembros y mi perfil.

Al elegir un mensaje, saltas a él dentro del canal, o dentro de su hilo si es una respuesta. Ningún resultado puede revelar contenido de un canal que no ves.

**Architecture:**
- **Texto completo en Postgres:**
  - columna generada `messages.search_tsv`, con configuración `simple` sobre el texto **sin acentos**;
  - índice GIN;
  - RPC `search_messages` **`SECURITY INVOKER`**, para que filtre la RLS de `messages` (`visible_channels()`).
- **Miembros:** RPC `search_members`, también invoker, bajo la RLS de `members`.
- **Canales:** se filtran en el cliente a partir de la lista visible que ya carga el layout. Sin consulta nueva.
- **Acciones:** lista estática filtrada por los permisos que ya conoce el layout.
- **Navegación a un mensaje:** `/c/<canal>?m=<id>` carga una página alrededor del mensaje, hace scroll y lo resalta. Si es una respuesta, abre su hilo y la resalta.

**Tech Stack:** F2c + el componente `command` de shadcn (dependencia `cmdk`), que se instala con el CLI de shadcn del repo, y la extensión `unaccent` de Postgres (esquema `extensions`).

**Spec:** `docs/superpowers/specs/2026-10-16-f2-foro-design.md`, decisión 15 y anti-objetivo 1 ("búsqueda"), con su padre `2026-10-16-plan-maestro.md` ("`search(q)`: `SECURITY INVOKER` para que la RLS filtre"). F2a, F2b y F2c ya están hechas.

## Global Constraints

- **Las RPCs de búsqueda son `SECURITY INVOKER`:**
  - nunca definer;
  - `set search_path = ''`;
  - `revoke execute … from public, anon`;
  - `grant` a `authenticated`.

  La visibilidad la da **solo** la RLS existente de `messages` y `members`.
- **Consulta del usuario:**
  1. Se recorta y se limita a 100 caracteres.
  2. Se tokeniza en palabras: secuencias de letras y dígitos Unicode, sin acentos y en minúsculas. Como máximo 8 términos.
  3. Cada término se convierte en prefijo `término:*` y se unen con `&`.
  4. **Nunca** se pasa texto del usuario a `to_tsquery` sin tokenizar.

  Si quedan 0 términos o la consulta tiene menos de 2 caracteres útiles → 0 filas, sin error.

  Lo hace la función `public._search_tsquery(p_q text) returns tsquery`: `immutable`, sin grant a nadie más que el propio uso interno de las RPCs. Las RPCs son invoker y la llaman, así que necesita `grant execute` a `authenticated`; es pura y no lee tablas.
- **Acentos:**
  - Wrapper `public.f_unaccent(text) returns text immutable parallel safe strict` sobre `extensions.unaccent('extensions.unaccent'::regdictionary, $1)`.
  - Columna `search_tsv tsvector generated always as (to_tsvector('simple', public.f_unaccent(body_text))) stored`.
  - Índice `messages_search_idx` GIN.
- **Mensajes:**
  - Se excluyen los borrados (`deleted_at is null`) y los vacíos.
  - Orden por `ts_rank` descendente y, después, `created_at` descendente.
  - `p_limit` entre 1 y 50, 20 por defecto.
  - Filtro opcional `p_channel`.
- **Fragmento:** se devuelve `left(body_text, 160)` en texto plano. El resaltado de los términos lo hace el cliente con nodos de texto de React. **Nunca** `ts_headline` con HTML ni `dangerouslySetInnerHTML`.
- **Miembros:**
  - Solo `status='active'`.
  - Coincide si:
    - `display_name` contiene la consulta, sin distinguir mayúsculas ni acentos;
    - o `wallet_address` empieza por la consulta en minúsculas (con o sin `0x`), cuando esta es hexadecimal y tiene ≥ 4 caracteres.
  - Se escapan `%`, `_` y `\` en los `LIKE`.
  - Límite de 10.
- **Paleta:**
  - **Apertura:** atajo `Mod+K` global, salvo dentro de un editor Tiptap con un menú `@` o `/` abierto, y un botón visible "Buscar" (≥ 44px) en la barra lateral y en la barra superior móvil.
  - **Grupos, en este orden:** Acciones, Canales, Miembros, Mensajes.
  - **Búsqueda remota:** debounce de 200 ms, ignorando respuestas obsoletas. Con la consulta vacía solo se muestran Acciones y Canales recientes.
  - **Teclado y accesibilidad:** con flechas, Enter y Escape; cuadro de diálogo con título accesible. Copy en español de tú.
- **Destinos:**
  - canal → `/c/<id>` (un foro o categoría no navega: se excluyen de la lista);
  - miembro → `/u/<wallet>`;
  - mensaje raíz → `/c/<canal>?m=<id>`;
  - respuesta → `/c/<canal>?thread=<raíz>&m=<id>`.
- **Acciones**, cada una solo si el miembro puede usarla:
  - "Crear invitación" → `/invites` (`CREATE_INVITES`);
  - "Ajustes del servidor" → `/settings` (`MANAGE_CHANNELS` o `MANAGE_ROLES`);
  - "Miembros" → `/admin/members` (`BAN_MEMBERS` o `VERIFY_MEMBERS`);
  - "Mis menciones" → `/notifications?filter=mentions`;
  - "Mis tickets" → `/tickets`;
  - "Abrir ticket en #<canal>" → `/c/<id>?openTicket=1`, por cada canal de texto con `ticketsEnabled` donde el miembro puede publicar;
  - "Cola de reportes" → `/moderation/reports` (la misma regla que el enlace de la barra lateral);
  - "Mi perfil" → `/u/<wallet>`.
- **SQL y UI:** las convenciones de siempre (`common-implementer.md`): TDD, `search.py` antes de la UI, tokens, ≥ 44px, foco visible, 375px sin scroll horizontal, sin BOM.

## Review Focus

1. **Consulta con sintaxis de tsquery o SQL** (`a & b | !c:*`, `'); drop`, `\`, `%_`, emojis, 10.000 caracteres) → sin error y sin resultados inesperados. *(Task 1)*
2. **Mensaje de un canal oculto, de un canal con gating `view` o borrado** → nunca aparece. Un miembro baneado, o una búsqueda como anon → nada. *(Task 1)*
3. **Escribir rápido "lin" → "linea"** → la lista muestra solo los resultados de "linea"; una respuesta lenta de "lin" no los pisa. *(Task 3)*
4. **Abrir `/c/<canal>?m=<id>` de un mensaje antiguo, fuera de la primera página** → se carga su contexto, se ve resaltado y "Cargar anteriores" sigue funcionando. Con un id de otro canal o inexistente → se ignora sin romper la vista. *(Task 2)*
5. **Cmd+K con el foco en el compositor y el menú de menciones abierto** → no roba el atajo a mitad de una mención. En otros sitios abre la paleta, y Escape devuelve el foco donde estaba. *(Task 3)*

---

## Estructura de archivos

```
supabase/migrations/20261017400001_search.sql      # unaccent wrapper, search_tsv, _search_tsquery, search_messages, search_members
supabase/tests/400_search.test.sql
src/lib/search/{queries,actions-list,highlight}.ts
src/components/search/{command-palette,search-button,search-provider}.tsx
src/components/ui/command.tsx (shadcn)
src/lib/chat/queries.ts (getMessagesAround) · src/components/chat/chat-view.tsx (?m=)
tests/unit/search/** · e2e/f2d-search.spec.ts
```

---

### Task 1: Búsqueda en Postgres

**Files:**
- Create: `supabase/migrations/20261017400001_search.sql`, `supabase/tests/400_search.test.sql`

**Interfaces:**
- **Produces:**
  - `create extension if not exists unaccent with schema extensions` y el wrapper `public.f_unaccent(text)`.
  - `messages.search_tsv` y el índice `messages_search_idx`.
  - `public._search_tsquery(p_q text) returns tsquery`, devuelve null si no hay términos.
  - `public.search_messages(p_q text, p_limit int default 20, p_channel uuid default null) returns table(id uuid, channel_id uuid, thread_root_id uuid, author_id uuid, created_at timestamptz, snippet text, rank real)`: **invoker**.
  - `public.search_members(p_q text, p_limit int default 10) returns table(id uuid, display_name text, wallet_address text)`: **invoker**.

- [ ] **Step 1: pgTAP**
  - Las funciones son `prosecdef = false` (invoker); anon sin EXECUTE.
  - Acentos y prefijos: "linea" encuentra "Línea"; "lin" encuentra "Linea" por prefijo.
  - Mensajes:
    - un mensaje de un canal sin VIEW nunca sale, ni siquiera con `p_channel` apuntando a él;
    - un mensaje borrado nunca sale;
    - una respuesta de hilo sale con su `thread_root_id`.
  - Consultas raras:
    - `'a & b | !c:*'`, `''''); drop table x; --`, `'%_\'`, una consulta solo de emojis y un string de 10.000 caracteres → sin error;
    - las vacías → 0 filas.
  - Límites: `p_limit` 0 o 500 se acota a 1–50.
  - Miembros:
    - por nombre sin acentos;
    - por un prefijo de wallet con y sin `0x`;
    - `%` no actúa como comodín;
    - los baneados no salen.
  - Un miembro baneado (`is_active_member` falso) obtiene 0 filas, porque así lo dice la RLS.
- [ ] **Step 2:** RED → implementar → GREEN (`pnpm db:test`).
- [ ] **Step 3:** Commit `feat(search): accent-insensitive full-text search under rls`.

### Task 2: Saltar a un mensaje (`?m=`)

**Files:**
- Modify: `src/lib/chat/queries.ts`, `src/app/(forum)/c/[channelId]/page.tsx`, `src/components/chat/chat-view.tsx`, `src/components/chat/message-list.tsx`, `src/components/chat/thread-panel.tsx`
- Test: `tests/unit/chat/**`

**Interfaces:**
- **Produces:**
  - `getMessagesAround(supabase, channelId, meId, messageId, { before = 15, after = 15 }): Promise<Hydrated & { hasMore: boolean; hasNewer: boolean; anchorId: string | null }>`:
    - mensajes raíz alrededor de la raíz objetivo, más antiguos primero;
    - `anchorId` es null si el mensaje no existe, no es visible o es de otro canal.
  - `ChatView` acepta `initialAnchorId?: string`:
    - carga con `getMessagesAround`;
    - hace scroll al ancla (`block: 'center'`, sin animación si `prefers-reduced-motion`);
    - aplica un resaltado de 2 s con el token de acento en el borde y `aria-current="true"` mientras dura.
  - **Con `?thread=` + `?m=`:** abre el hilo y resalta la respuesta.
  - **Cuando hay `hasNewer`:** muestra el botón "Ir a lo más reciente", que vuelve a la vista normal y quita `m` de la URL con `router.replace`.
  - **Validación:** `m` y `thread` se validan como uuid en la página.

- [ ] **Step 1: unit**
  - `getMessagesAround` con un cliente falso: el orden y los cursores.
  - Un ancla inexistente → vista normal.
  - El ancla se resalta y recibe `scrollIntoView`.
  - Una respuesta abre el hilo y la resalta.
  - "Ir a lo más reciente" limpia la URL.
  - "Cargar anteriores" funciona desde la vista anclada.
- [ ] **Step 2:** RED → implementar → GREEN, más `pnpm build`.
- [ ] **Step 3:** Commit `feat(chat): jump to a message with highlighted context`.

### Task 3: Paleta Cmd+K

**Files:**
- Create:
  - `src/components/ui/command.tsx` (shadcn);
  - `src/components/search/{command-palette,search-button,search-provider}.tsx`;
  - `src/lib/search/{queries,actions-list,highlight}.ts`.
- Modify:
  - el layout del foro: monta el provider, con los datos que ya carga (canales visibles, permisos y `has_any_channel_perm(8)`);
  - `sidebar.tsx` y `topbar.tsx`: el botón "Buscar";
  - `src/app/(forum)/c/[channelId]/page.tsx` y el diálogo de abrir ticket, para que `?openTicket=1` lo abra si el miembro puede.
- Test: `tests/unit/search/**`

**Interfaces:**
- **Produces:**
  - `searchMessages(supabase, q, opts?)` y `searchMembers(supabase, q)`, que llaman a las RPCs con el cliente del navegador del usuario.
  - `buildActions({perms, canReports, ticketChannels, wallet}): PaletteAction[]`, pura y testeable.
  - `highlight(text, q): Array<{text: string; match: boolean}>`, pura, con la misma tokenización que SQL: sin acentos, en minúsculas y por prefijo.
  - `CommandPalette` con los grupos y destinos de Global Constraints, mostrando "Buscando…", "Sin resultados para «q»" y el error "No se pudo buscar. Inténtalo de nuevo."
  - Los resultados de mensaje muestran "#canal · autor · fecha" y el fragmento resaltado.

- [ ] **Step 1:** `search.py` (consultas cortas: "command palette", "search", "keyboard"). Indicar con honestidad qué devolvió resultados.
- [ ] **Step 2: unit**
  - `buildActions`, para cada combinación de permisos.
  - `highlight` con acentos y prefijos, sin HTML.
  - La paleta:
    - abre con Mod+K;
    - no abre si el evento viene de un editor con sugerencias abiertas (`aria-expanded` en el compositor);
    - Escape devuelve el foco.
  - La respuesta obsoleta se descarta (dos promesas que resuelven en orden inverso).
  - Un canal foro o categoría no aparece.
  - Elegir un mensaje navega a la URL correcta.
  - `?openTicket=1` abre el diálogo solo si `ticketsEnabled` y el miembro puede publicar.
- [ ] **Step 3:** RED → implementar → GREEN, más `pnpm build`.
- [ ] **Step 4:** Commit `feat(search): cmd+k palette for actions, channels, members and messages`.

### Task 4: E2E de F2d y capturas

**Files:**
- Create: `e2e/f2d-search.spec.ts`
- Modify: `e2e/screens.spec.ts`, con `@screens` de la paleta abierta con resultados a 375 y 1440.

- [ ] **Step 1: escenarios con wallets de prueba generadas**
  1. A busca una palabra con acento escrita sin acento → ve el mensaje. Al pulsar Enter llega a `/c/<canal>?m=<id>` con el mensaje resaltado, aunque esté fuera de la primera página (sembrar 60 mensajes).
  2. Visibilidad: un mensaje de un canal oculto para A, con una palabra única → A no lo encuentra. El admin sí.
  3. Una respuesta de hilo → abre el hilo resaltado.
  4. Buscar a un miembro por prefijo de wallet → `/u/<wallet>`.
  5. Las acciones visibles según el rol: un miembro normal no ve "Ajustes del servidor"; el admin sí. "Abrir ticket en #Soporte Técnico" abre el diálogo.
  6. Con el teclado solo: Ctrl+K, flechas, Enter y Escape.
- [ ] **Step 2:** Pasar las suites completas (`lint`, `typecheck`, `test`, `db:test`, `build`, `test:e2e`, y `SCREENS=1`) y revisar las capturas.
- [ ] **Step 3:** Commit `test(e2e): f2d command palette acceptance`.
