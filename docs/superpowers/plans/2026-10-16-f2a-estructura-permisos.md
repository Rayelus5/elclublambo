# F2a — Estructura de canales y permisos en cascada · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El foro tiene un árbol de categorías → foros anidables → canales de texto con permisos en cascada por rol y por miembro. La barra lateral muestra solo lo visible para cada miembro. Admins y delegados gestionan árbol, permisos, roles, dominios permitidos y el rol Verificado desde un panel, sin poder escalar privilegios.

**Architecture:**
- **Postgres es la autoridad.** Tabla `channels` (árbol), `permission_overwrites` y la función `channel_permissions(member, channel)`, que recorre el camino raíz→nodo con el algoritmo de Discord.
- **Escrituras solo por RPC** `SECURITY DEFINER` con reglas anti-escalada.
- **Espejo TS puro** (`computeChannelPermissions`) para la UI, con paridad demostrada contra la BD usando fixtures JSON compartidos.
- **UI:** server components bajo `(forum)` y `(forum)/settings`.

**Tech Stack:** Igual que F1 (Next 16.4 cacheComponents, Supabase local, pgTAP, Vitest, Playwright), más `@dnd-kit/core` y `@dnd-kit/sortable` (reordenar con teclado).

**Spec:** `docs/superpowers/specs/2026-10-16-f2-foro-design.md`, con su padre `docs/superpowers/specs/2026-10-16-plan-maestro.md`.

## Global Constraints

- **Bits** (bigint; mismos valores en SQL y en `src/lib/permissions/bits.ts`):

  | Bit | Valor | | Bit | Valor |
  |---|---|---|---|---|
  | `VIEW_CHANNEL` | 1 | | `ADMINISTRATOR` | 512 |
  | `SEND_MESSAGES` | 2 (antes `CREATE_THREADS`) | | `ATTACH_FILES` | 1024 |
  | `SEND_IN_THREADS` | 4 (antes `SEND_REPLIES`) | | `EMBED_LINKS` | 2048 |
  | `MANAGE_MESSAGES` | 8 | | `MENTION_EVERYONE` | 4096 |
  | `CREATE_INVITES` | 16 | | `ADD_REACTIONS` | 8192 |
  | `BAN_MEMBERS` | 32 | | `MANAGE_TICKETS` | 16384 |
  | `MANAGE_ROLES` | 64 | | `VERIFY_MEMBERS` | 32768 |
  | `MANAGE_CHANNELS` | 128 | | | |
  | `MANAGE_TREASURY` | 256 | | | |

  - `ALL_PERMS = 65535`.
  - `CHANNEL_MASK = 31759` (`1|2|4|8|1024|2048|4096|8192|16384`): los únicos bits que pueden aparecer en un overwrite.
  - `GLOBAL_MASK = ALL_PERMS & ~CHANNEL_MASK`.
- **Roles semilla:**

  | Rol | position | permissions | is_system |
  |---|---|---|---|
  | `@everyone` | 0 | **8199** (VIEW+SEND_MESSAGES+SEND_IN_THREADS+ADD_REACTIONS) | — |
  | `Padrino` | 10 | 16 | — |
  | `Verificado` | 20 | 3072 | — |
  | `Soporte` | 100 | 19456 (TICKETS+ATTACH+EMBED) | — |
  | `Moderador` | 500 | 56360 (MANAGE_MESSAGES+BAN+ATTACH+EMBED+MENTION_EVERYONE+TICKETS+VERIFY) | — |
  | `SuperAdmin` | 1000 | 512 | sí |

  Colores en hex mayúsculas: Verificado `#3DDC84`, Soporte `#FFB020`, Moderador `#FF5A5A`.
- **Migración de datos:** todos los miembros con `status='active'` y todos los holders de Padrino reciben Verificado. Es idempotente.
- **`member_global_permissions`:**
  - Admin → **65535**.
  - Si no: `(base & ~deny) | (allow & GLOBAL_MASK)`. Las penalizaciones nunca conceden bits de canal.
- **`channel_permissions(p_member uuid, p_channel uuid) returns bigint`:**
  1. Miembro no activo o canal inexistente → 0.
  2. `roles_base` = OR de los permisos de `@everyone` y de los roles del miembro. Si `& 512` → 65535.
  3. `p = roles_base`.
  4. Para cada nodo del camino, de la raíz al canal:
     1. `p = (p & ~ev.deny) | ev.allow`, donde `ev` es el overwrite de `@everyone` en ese nodo.
     2. `p = (p & ~OR(role.deny)) | OR(role.allow)`, sobre los roles del miembro.
     3. `p = (p & ~mem.deny) | mem.allow`, el overwrite del propio miembro.
     4. Si `(p & 1) = 0` → devolver `p & GLOBAL_MASK`. Un nodo oculto oculta todo lo que cuelga de él.
  5. Penalización final: `p = p & ~override.deny`.
  6. Hook DAO: si `gate_passes(member, channel, scope) = false` (en F2a **siempre true**):
     - con `scope='view'` se quita VIEW y todos los bits de canal;
     - con `scope='post'` se quitan `SEND_MESSAGES` y `SEND_IN_THREADS`.
  7. Devolver `p`.
- **Árbol:**
  - `kind ∈ {category, forum, text}`.
  - `category` solo en la raíz (`parent_id is null`).
  - `forum` y `text` tienen padre `category` o `forum`. `text` nunca es padre.
  - Profundidad ≤ 6 (la raíz es la profundidad 1).
  - `name` de 1 a 50 caracteres tras trim.
  - `slowmode_seconds` = 0, o entre 5 y 604800.
  - `tickets_enabled` y `alpha_enabled` solo pueden ser `true` en `text`.
  - Columnas `gate_mode text default 'none' check in ('none','min_share_bps','min_net_usdc')`, `gate_value numeric`, `gate_scope text default 'view' check in ('view','post')`.
  - Orden por `position` entre hermanos.
- **Anti-escalada** (aplicada en cada RPC de gestión):
  - **Gestionar el árbol:** requiere `MANAGE_CHANNELS` global (o admin) **y** `VIEW` sobre el nodo afectado y sobre su padre destino.
  - **Overwrites:**
    - Requieren `MANAGE_CHANNELS`, y los bits de `allow|deny` deben estar dentro de `CHANNEL_MASK` y dentro de `channel_permissions(actor, channel)`. Solo tocas bits que tienes en ese canal; el admin todos.
    - Si el destino es un rol: su `position` debe ser < la posición más alta del actor (salvo admin) y no puede ser SuperAdmin.
    - Si el destino es un miembro: su posición más alta debe ser < la del actor, y nunca puede ser el propio actor (salvo admin).
  - **Roles:** requieren `MANAGE_ROLES`.
    - Crear/editar: `permissions ⊆ member_global_permissions(actor)` y `position` < la posición más alta del actor.
    - No se tocan `is_system` ni el nombre o la posición de `@everyone` (sí sus permisos, dentro de los del actor).
    - Borrar: no system ni everyone, y posición < la del actor.
  - **Verificado:** `set_verified(p_member, p_enabled)` requiere `VERIFY_MEMBERS` (o admin). El destino debe estar activo, ser de posición más alta < la del actor y no ser el propio actor.
- **Errores nuevos** (añadir a `src/lib/errors.ts` con copy en español): `not_empty`, `invalid_tree`, `depth_limit`.
- **SQL:** igual que F1. `SECURITY DEFINER`, `set search_path=''`, `revoke ... from public, anon`, grants explícitos, y escrituras solo por RPC.
- **UI:**
  - Consultar ui-ux-pro-max antes de cada UI (dejarlo en report y commit).
  - Tokens §1; Lucide; ≥44px; foco 2px accent; `prefers-reduced-motion`; 375px sin scroll horizontal.
  - Copy en español de tú.
  - **Nunca escribir archivos con PowerShell `Set-Content`/`Out-File`** (meten BOM).
- **Entorno:**
  - pnpm desde PowerShell con `$env:PATH = "$env:SystemRoot\System32;$env:USERPROFILE\corepack-bin;$env:PATH"`.
  - `pnpm db:test` resetea la BD; `pnpm test:e2e` también.

## Review Focus

1. **Overwrite de miembro que concede VIEW bajo un ancestro oculto para él** → sigue sin ver nada. *(Task 3, `hidden_ancestor_beats_descendant_allow`)*
2. **Penalización global con `allow` de bits de canal** (por ejemplo una fila con allow=1) → no revela canales. *(Task 1 `override_allow_ignores_channel_bits` + Task 3 `penalty_allow_cannot_reveal`)*
3. **Moderador que intenta darse a sí mismo o a su rol `MANAGE_CHANNELS` o VIEW sobre un canal oculto** vía overwrite o rol → `forbidden`/`hierarchy`. *(Task 5)*
4. **Mover un foro dentro de su propio descendiente**, o pasar de 6 niveles → `invalid_tree`/`depth_limit`, sin dejar el árbol a medias. *(Task 4)*
5. **Borrar un rol con overwrites o miembros** → limpieza en cascada, y los permisos efectivos se recalculan sin errores. *(Task 5)*

---

## Estructura de archivos

```
supabase/migrations/20261016100001_permissions_v2.sql    # bits, roles semilla, Verificado a miembros, member_global_permissions, set_verified
supabase/migrations/20261016100002_channels.sql          # channels, permission_overwrites, triggers árbol, RLS
supabase/migrations/20261016100003_channel_permissions.sql
supabase/migrations/20261016100004_channel_admin.sql     # RPCs árbol + overwrites + roles + allowed_domains
supabase/migrations/20261016100005_seed_channels.sql
supabase/tests/060_permissions_v2.test.sql … 100_seed.test.sql
tests/fixtures/channel-permissions.json                  # casos compartidos SQL/TS
src/lib/permissions/{bits,channel}.ts                    # channel.ts = computeChannelPermissions + tipos
src/lib/channels/{queries,actions,tree}.ts               # tree.ts = construir árbol / aplanar (puro)
src/app/(forum)/c/[channelId]/page.tsx                   # texto: placeholder hasta F2b; foro: lista de hijos
src/app/(forum)/settings/{layout,page}.tsx + channels/ roles/ links/
src/components/shell/channel-tree.tsx
src/components/settings/{channel-tree-editor,channel-form,permission-matrix,role-list,role-form,domain-list}.tsx
tests/unit/** · tests/integration/channel-permissions-parity.test.ts · e2e/f2a-structure.spec.ts
```

---

### Task 1: Permisos v2 (bits, roles semilla, Verificado)

**Files:**
- Create: `supabase/migrations/20261016100001_permissions_v2.sql`, `supabase/tests/060_permissions_v2.test.sql`
- Modify: `src/lib/permissions/bits.ts`, `tests/unit/permissions.test.ts`
- Modify: los asserts de F1 que esperan 1023 (`supabase/tests/{020,030,040,050}*.sql`) → 65535
- Modify: usos TS de `CREATE_THREADS`/`SEND_REPLIES` (grep)
- Modify: `src/lib/moderation/actions.ts` (añadir `setVerifiedAction`)

**Interfaces:**
- **Produces (SQL):**
  - `member_global_permissions` v2.
  - `public.set_verified(p_member uuid, p_enabled boolean) returns void` (authenticated). Audit `member_verified_set`.
  - Roles semilla.
- **Produces (TS):**
  - `Perm` con los 16 bits (renombrados).
  - `ALL_PERMS = 65535n`, `CHANNEL_MASK = 31759n`, `GLOBAL_MASK`.
  - `hasPerm` sin cambios.
  - `setVerifiedAction({ memberId, enabled }) → { error?: string }`.

- [ ] **Step 1:** Escribir los tests pgTAP en `060`:
  - Roles semilla con position/permissions exactos.
  - `@everyone` = 8199.
  - Miembros activos previos y Padrinos tienen Verificado.
  - Admin → 65535.
  - `override_allow_ignores_channel_bits`: override allow=1|16 sobre un miembro sin VIEW por rol → `member_global_permissions & 1 = 0`, `& 16 = 16`.
  - `set_verified`:
    - Moderador a un miembro raso → OK y audit.
    - Moderador a otro Moderador → `hierarchy`.
    - Miembro raso → `forbidden`.
    - A sí mismo → `hierarchy`.
    - A un baneado → `invalid_input`.
- [ ] **Step 2:** Tests de Vitest en `permissions.test.ts`: valores exactos de los 16 bits, `ALL_PERMS`, `CHANNEL_MASK`, `GLOBAL_MASK`, y `CHANNEL_MASK & GLOBAL_MASK === 0n`.
- [ ] **Step 3:** RED → implementar (migración nueva; actualizar los asserts 1023 de F1) → `pnpm db:test` y `pnpm test` GREEN. Typecheck limpio tras renombrar.
- [ ] **Step 4:** Commit `feat(perms): permission bits v2, staff roles and verified role`.

### Task 2: Esquema del árbol de canales

**Files:**
- Create: `supabase/migrations/20261016100002_channels.sql`, `supabase/tests/070_channels_schema.test.sql`
- Modify: `supabase/tests/000_helpers.test.sql` (helper `tests.create_channel(p_parent uuid, p_kind text, p_name text) returns uuid` como postgres)

**Interfaces:**
- **Produces:**
  - `public.channels`:
    - `id`, `parent_id` → channels `on delete restrict`, `kind`, `name`, `topic` (≤ 300)
    - `position int not null default 0`, `slowmode_seconds int not null default 0`
    - `tickets_enabled bool default false`, `alpha_enabled bool default false`
    - `gate_mode`, `gate_value`, `gate_scope`
    - `created_by` → members, `created_at`
  - `public.permission_overwrites`:
    - `id`, `channel_id` → channels `on delete cascade`, `target_type in ('role','member')`, `target_id uuid`
    - `allow bigint default 0`, `deny bigint default 0`
    - unique `(channel_id, target_type, target_id)`
    - checks `(allow|deny) & ~31759 = 0` y `allow & deny = 0`
  - Trigger `channels_tree_guard` (BEFORE INSERT OR UPDATE) que valida las reglas de árbol de Global Constraints:
    - incluye ciclos (al mover);
    - mueve la comprobación de profundidad al **subárbol** completo;
    - lanza `invalid_tree` / `depth_limit`.
  - Trigger que borra los overwrites de destino rol/miembro al borrar el rol o el miembro (o FKs lógicas vía trigger en `roles`).
  - RLS activa sin políticas (Task 3 las añade).

- [ ] **Step 1:** Tests pgTAP:
  - Columnas y checks.
  - category con padre → `invalid_tree`; text como padre → `invalid_tree`; foro en raíz → `invalid_tree`.
  - Profundidad 7 → `depth_limit`.
  - Mover un foro bajo su hijo → `invalid_tree`.
  - Mover un subárbol de profundidad 3 a un nodo de profundidad 4 → `depth_limit`.
  - Slowmode 3 → check (23514); 604801 → check.
  - `tickets_enabled` en foro → check.
  - Overwrite con bit 16 → check; allow & deny solapados → check.
  - El generic RLS-enabled y anon-no-access de F1 siguen pasando.
- [ ] **Step 2:** RED → implementar → GREEN.
- [ ] **Step 3:** Commit `feat(db): channel tree schema with integrity triggers`.

### Task 3: Permisos en cascada + paridad SQL/TS

**Files:**
- Create: `supabase/migrations/20261016100003_channel_permissions.sql`, `supabase/tests/080_channel_permissions.test.sql`
- Create: `tests/fixtures/channel-permissions.json`, `src/lib/permissions/channel.ts`
- Create: `tests/unit/channel-permissions.test.ts`, `tests/integration/channel-permissions-parity.test.ts`

**Interfaces:**
- **Produces (SQL):**
  - `public.gate_passes(p_member uuid, p_channel uuid, p_scope text) returns boolean`: devuelve true; comentario `-- F3: DAO gating`.
  - `public.channel_permissions(p_member, p_channel) returns bigint`, ejecutable por `authenticated` y `service_role`.
  - `public.can(p_channel uuid, p_bit bigint) returns boolean`, sobre el miembro actual.
  - `public.can_view(p_channel uuid) returns boolean`.
  - `public.visible_channels() returns setof public.channels` (los que puede ver el miembro actual).
  - Política SELECT en `channels`: `public.can_view(id)`.
  - Política SELECT en `permission_overwrites`: `public.has_global_perm(128)` y `can_view(channel_id)`.
- **Produces (TS):**
  - `type ChannelPermInput = { rolesBase: bigint; isAdmin: boolean; path: Array<{ everyone?: Ow; roles: Ow[]; member?: Ow }>; penaltyDeny: bigint; active: boolean }`, con `type Ow = { allow: bigint; deny: bigint }`.
  - `computeChannelPermissions(i: ChannelPermInput): bigint`.
  - El JSON guarda los bigint como strings decimales.

- [ ] **Step 1:** Fixtures JSON. Al menos 14 casos, cada uno con un escenario declarativo (roles con perms, nodos camino, overwrites por nivel, penalización) y el resultado esperado:
  - cascada simple;
  - deny de rol vs allow de rol en el mismo nivel (allow gana);
  - miembro gana a rol;
  - `hidden_ancestor_beats_descendant_allow`;
  - admin;
  - `penalty_allow_cannot_reveal`;
  - penalización deny de SEND;
  - miembro no activo → 0;
  - everyone deny + rol allow;
  - tres niveles alternando;
  - overwrite de un rol que el miembro no tiene (sin efecto).
- [ ] **Step 2:** `channel-permissions.test.ts` recorre el JSON con `computeChannelPermissions`.
- [ ] **Step 3:** `channel-permissions-parity.test.ts` (Vitest integration):
  - Por cada caso, siembra el escenario en la BD local con el cliente service role, usando nombres únicos por caso.
  - Llama `rpc('channel_permissions')` y compara con el valor esperado **y** con la salida TS.
  - Limpia al terminar.
  - Se salta si Supabase no responde, como el test web3 de F1.
- [ ] **Step 4:** pgTAP `080`:
  - Políticas: un miembro solo selecciona canales visibles; un nodo oculto oculta sus hijos en la SELECT.
  - `permission_overwrites` invisible sin 128.
  - `can()` y `can_view()` para el miembro actual.
  - anon sin EXECUTE.
- [ ] **Step 5:** RED → implementar → GREEN (`pnpm test`, `pnpm db:test`).
- [ ] **Step 6:** Commit `feat(perms): cascading channel permissions with sql/ts parity`.

### Task 4: RPCs de gestión del árbol

**Files:**
- Create: `supabase/migrations/20261016100004_channel_admin.sql` (parte árbol), `supabase/tests/090_channel_admin.test.sql`

**Interfaces:**
- **Produces** (todas authenticated, con anti-escalada de Global Constraints y audit `channel_*`):
  - `create_channel(p_parent uuid, p_kind text, p_name text, p_topic text default null) returns uuid`: se coloca al final de sus hermanos.
  - `update_channel(p_id uuid, p_name text, p_topic text, p_slowmode int, p_tickets boolean, p_alpha boolean) returns void`.
  - `move_channel(p_id uuid, p_new_parent uuid, p_index int) returns void`: reubica y renumera las posiciones de los hermanos de origen y destino de forma contigua (0..n-1).
  - `delete_channel(p_id uuid) returns void`: con hijos → `not_empty`.

- [ ] **Step 1:** Tests pgTAP:
  - Sin 128 → `forbidden`.
  - Con 128 pero sin VIEW sobre el destino → `forbidden`.
  - create/update/move/delete felices.
  - Renumeración contigua tras mover.
  - Mover bajo un descendiente → `invalid_tree` y el árbol queda igual (sin cambios parciales).
  - Borrar con hijos → `not_empty`.
  - Name vacío → `invalid_input`.
- [ ] **Step 2:** RED → implementar → GREEN.
- [ ] **Step 3:** Commit `feat(channels): tree management rpcs with anti-escalation`.

### Task 5: RPCs de overwrites, roles y dominios permitidos

**Files:**
- Modify: `supabase/migrations/20261016100004_channel_admin.sql` (añadir; sin enviar todavía, editable en sitio)
- Create: `supabase/tests/095_roles_overwrites.test.sql`

**Interfaces:**
- **Produces:**
  - `set_overwrite(p_channel uuid, p_target_type text, p_target uuid, p_allow bigint, p_deny bigint) returns void`: allow=deny=0 borra la fila.
  - `create_role(p_name text, p_color text, p_permissions bigint) returns uuid`: posición = (máx posición < top del actor) + 1, o 1.
  - `update_role(p_role uuid, p_name text, p_color text, p_permissions bigint) returns void`.
  - `delete_role(p_role uuid) returns void`.
  - `move_role(p_role uuid, p_position int) returns void`: el destino < top del actor; desplaza el resto.
  - Tabla `allowed_domains(domain text primary key check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'), added_by uuid, created_at)`:
    - semilla: `lineascan.build`, `sepolia.lineascan.build`, `linea.build`, `github.com`, `x.com`, `dexscreener.com`, `etherscan.io`;
    - SELECT para miembros activos;
    - `add_allowed_domain(p_domain text)` y `remove_allowed_domain(p_domain text)` requieren `MANAGE_CHANNELS`.
  - Al borrar un rol se eliminan sus overwrites y `member_roles` (cascada).
- **Políticas:** SELECT `roles` ya existe (F1).

- [ ] **Step 1:** Tests pgTAP:
  - set_overwrite:
    - concede un bit que el actor no tiene en ese canal → `forbidden`;
    - bit global → `invalid_input`;
    - rol de posición ≥ la del actor → `hierarchy`;
    - SuperAdmin → `forbidden`;
    - sobre sí mismo → `hierarchy`;
    - el admin puede con todo.
  - Roles:
    - create con bits no poseídos → `hierarchy`;
    - update de un system → `forbidden`;
    - update de `@everyone` (cambiar permisos OK, nombre → `forbidden`);
    - delete en cascada;
    - move por encima de uno mismo → `hierarchy`.
  - Dominios: formato inválido → `invalid_input`; sin 128 → `forbidden`.
- [ ] **Step 2:** RED → implementar → GREEN.
- [ ] **Step 3:** Commit `feat(roles): role and overwrite rpcs with discord-style anti-escalation`.

### Task 6: Canales semilla

**Files:**
- Create: `supabase/migrations/20261016100005_seed_channels.sql`, `supabase/tests/100_seed.test.sql`

**Interfaces:**
- **Produces** (insert como postgres, sin `created_by`):
  - Categoría **Comunidad**: General, Reglas, Anuncios, Noticias.
  - Categoría **Mercado**: Trading (`alpha_enabled`), Airdrops (foro: L1 y L2 como texto, ambos `alpha_enabled`), Links de referidos.
  - Categoría **Ayuda**: Consejos antiscam, Soporte Técnico (`tickets_enabled`), Ayuda (`tickets_enabled`).
  - Reglas, Anuncios y Consejos antiscam llevan:
    - overwrite `@everyone` deny = SEND_MESSAGES|SEND_IN_THREADS (6);
    - overwrite Moderador allow = 6.
  - Topics en español breves.

- [ ] **Step 1:** pgTAP:
  - Estructura exacta (nombres, kinds, padres, orden).
  - Flags.
  - Un miembro raso tiene VIEW pero no SEND en Reglas, y SEND en General.
  - Moderador SEND en Anuncios.
- [ ] **Step 2:** RED → implementar → GREEN.
- [ ] **Step 3:** Commit `feat(channels): seed default channel structure`.

### Task 7: Árbol en la barra lateral y páginas de canal

**Files:**
- Create: `src/lib/channels/{tree,queries}.ts`, `src/components/shell/channel-tree.tsx`, `src/app/(forum)/c/[channelId]/page.tsx`
- Modify: `src/components/shell/sidebar.tsx`, `src/app/(forum)/layout.tsx`
- Create: `tests/unit/{channel-tree,tree-utils}.test.tsx`

**Interfaces:**
- **Produces:**
  - `buildTree(rows: ChannelRow[]): TreeNode[]` (puro; ordena por position; descarta huérfanos cuyo padre no es visible).
  - `ChannelRow = { id; parentId: string|null; kind: 'category'|'forum'|'text'; name; topic: string|null; position: number }`.
  - `getVisibleChannels()` (server; `select` a `channels`, que ya filtra la RLS).
  - `<ChannelTree nodes activeId />`:
    - categorías como encabezados colapsables (estado en localStorage con try/catch);
    - foros con chevron expandible;
    - texto con icono `Hash`, `aria-current`.
  - `/c/[id]`:
    - canal invisible o inexistente → `notFound()`;
    - `text` → cabecera (nombre, topic, chips "Slowmode Xs", "Tickets", "Alpha") y placeholder "El chat llega en la siguiente entrega.";
    - `forum` → lista de hijos visibles como tarjetas-enlace.
- [ ] **Step 1:** `search.py "nested channel tree sidebar collapsible" --domain ux` (fallback style) y aplicar.
- [ ] **Step 2:** Tests:
  - `buildTree` (orden, anidado, huérfanos fuera).
  - ChannelTree:
    - render de la jerarquía;
    - colapsar/expandir con teclado (Enter/Space, `aria-expanded`);
    - `aria-current` en el activo;
    - enlaces `/c/<id>`.
- [ ] **Step 3:** RED → implementar → GREEN. `pnpm build` limpio.
- [ ] **Step 4:** Commit `feat(shell): channel tree sidebar and channel pages`.

### Task 8: Ajustes — editor del árbol

**Files:**
- Create: `src/app/(forum)/settings/{layout,page}.tsx`, `src/app/(forum)/settings/channels/page.tsx`, `src/lib/channels/actions.ts`
- Create: `src/components/settings/{channel-tree-editor,channel-form}.tsx`
- Create: `tests/unit/{channel-tree-editor,channel-form,channel-actions}.test.tsx`
- Modify: `src/components/shell/sidebar.tsx` (enlace "Ajustes" si tiene 128, 64 o 512)

**Interfaces:**
- **Consumes:** RPCs de la Task 4.
- **Produces:**
  - Server actions con validación previa y `revalidatePath('/settings/channels')` + `revalidatePath('/', 'layout')`:
    - `createChannelAction`
    - `updateChannelAction`
    - `moveChannelAction({ id, parentId, index })`
    - `deleteChannelAction`
  - `/settings` redirige a la primera sección permitida. Sin 128, 64 ni 512 → `notFound`.
  - Editor del árbol:
    - lista anidada;
    - reordenar entre hermanos con dnd-kit (sensores de puntero **y** teclado, anuncios aria-live en español);
    - botón "Mover a…" (diálogo con selector de padre válido) para cambiar de padre;
    - botón "Nuevo" por nodo contenedor;
    - seleccionar un nodo abre `<ChannelForm>`: nombre, topic, slowmode con presets 0/5 s/10 s/30 s/1 min/5 min/15 min/1 h/6 h/1 día/1 semana + "Personalizado (segundos)" validado 5..604800, tickets y alpha solo en texto, y borrar con confirmación.
- [ ] **Step 1:** `search.py "settings tree editor drag and drop" --domain ux`, y añadir `@dnd-kit/core` y `@dnd-kit/sortable`.
- [ ] **Step 2:** Tests:
  - Slowmode personalizado fuera de rango → error inline.
  - Tickets/alpha ocultos en foro.
  - "Mover a…" excluye el propio subárbol y los nodos `text`.
  - Las acciones llaman a la RPC con los argumentos correctos y mapean errores con `rpcErrorMessage`.
  - Reordenar por teclado dispara `moveChannelAction` con el índice correcto.
- [ ] **Step 3:** RED → implementar → GREEN. Build limpio.
- [ ] **Step 4:** Commit `feat(settings): channel tree editor`.

### Task 9: Ajustes — matriz de permisos, roles y dominios

**Files:**
- Create: `src/components/settings/{permission-matrix,role-list,role-form,domain-list}.tsx`
- Create: `src/app/(forum)/settings/roles/page.tsx`, `src/app/(forum)/settings/links/page.tsx`
- Modify: `src/lib/channels/actions.ts`, `src/app/(forum)/settings/channels/page.tsx`
- Create: `src/lib/roles/actions.ts`, `tests/unit/{permission-matrix,role-form,domain-list}.test.tsx`

**Interfaces:**
- **Produces:**
  - `<PermissionMatrix channelId overwrites roles members permLabels />`:
    - filas = destinos (`@everyone`, cada rol con overwrite, "Añadir rol/miembro");
    - columnas = los 9 bits de canal con etiqueta en español;
    - celda tri-estado permitir ✓ / heredar / denegar ✕, como botón con `aria-pressed`-like o radiogroup;
    - guardar por fila → `setOverwriteAction`.
  - Etiquetas: VIEW "Ver canal", SEND_MESSAGES "Enviar mensajes", SEND_IN_THREADS "Responder en hilos", MANAGE_MESSAGES "Moderar mensajes", ATTACH_FILES "Adjuntar imágenes", EMBED_LINKS "Insertar enlaces", MENTION_EVERYONE "Mencionar a todos", ADD_REACTIONS "Reaccionar", MANAGE_TICKETS "Gestionar tickets".
  - `/settings/roles` (requiere 64):
    - lista por posición con color;
    - crear/editar (nombre, color de una paleta de tokens o hex validado, checkboxes de los 16 bits con etiquetas en español, deshabilitando los que el actor no tiene);
    - subir/bajar posición;
    - borrar con confirmación.
  - `/settings/links` (requiere 128): lista de dominios + añadir/quitar.
- [ ] **Step 1:** `search.py "permission matrix tri-state toggle table" --domain ux` y aplicar.
- [ ] **Step 2:** Tests:
  - Ciclo tri-estado y payload allow/deny correcto.
  - Celdas de bits que el actor no tiene deshabilitadas.
  - RoleForm deshabilita bits no poseídos y valida el color.
  - DomainList valida el formato y llama a las acciones.
- [ ] **Step 3:** RED → implementar → GREEN. Build limpio.
- [ ] **Step 4:** Commit `feat(settings): permission matrix, roles and allowed domains`.

### Task 10: Verificado en Miembros + E2E de F2a

**Files:**
- Modify: `src/components/members/member-table.tsx`, `src/app/(forum)/admin/members/page.tsx` (visible con 32, 32768 o 512), `tests/unit/member-table.test.tsx`
- Create: `e2e/f2a-structure.spec.ts` (+ capturas @screens de `/c/<general>`, `/settings/channels`, `/settings/roles` en 375/1440)

**Interfaces:**
- **Consumes:** `setVerifiedAction` (Task 1), helpers E2E de F1 (`loginAs`, admin del E2E).
- **Produces:**
  - Toggle "Verificado: <nombre>" (`aria-pressed`) por fila activa, si el actor tiene 32768 o 512.
  - Badge "Verificado".
  - E2E:
    1. El admin ve el árbol semilla en la barra lateral.
    2. El admin crea el canal de texto "VIP" bajo Comunidad y deniega VIEW a `@everyone` → un miembro B no lo ve en la barra lateral y `/c/<vip>` da 404.
    3. El admin concede a B un overwrite de miembro con VIEW → B lo ve.
    4. Un Moderador (rol dado por el admin) verifica a B desde Miembros → aparece el badge.
    5. Sin errores de consola en las páginas nuevas.
- [ ] **Step 1:** Tests unitarios del toggle → RED → GREEN.
- [ ] **Step 2:** E2E RED (rutas inexistentes o selectores) → GREEN. Ejecutar `@screens` y revisar las capturas.
- [ ] **Step 3:** Verificación completa (lint, typecheck, test, db:test, build, test:e2e) con salidas en el report.
- [ ] **Step 4:** Commit `test(e2e): f2a channel structure acceptance`.
