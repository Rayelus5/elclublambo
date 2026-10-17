# F2c — Avisos y soporte · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bandeja de notificaciones en la app y Web Push (menciones, respuestas, canales seguidos, invitaciones, moderación, tickets), preferencias de "seguir" por canal, reportes de mensajes con cola de moderación y tickets privados (autor + staff). Ningún aviso, push ni ticket puede filtrar contenido de un canal o ticket que el destinatario no puede ver.

**Architecture:**
- **Notificaciones en Postgres:**
  - Tabla `notifications`, solo con IDs y tipo, sin texto copiado del mensaje.
  - Se crean dentro de funciones `SECURITY DEFINER`: en el fan-out de mensajes y en triggers de invitaciones, baneos, reportes y tickets.
  - Cada destinatario se filtra con `channel_permissions(destinatario, canal) & 1` en el momento de crearla.
  - La lectura pasa por RLS, que vuelve a exigir que el canal o el ticket sean visibles.
- **Tiempo real:** tema privado `member:<id>`, solo para su dueño, que avisa de cada notificación nueva (solo el ID). El cliente relee por RLS.
- **Web Push:**
  - Un despachador Node (`web-push`, VAPID) reclama las notificaciones pendientes con una RPC solo de `service_role`.
  - Esa RPC **revalida la visibilidad en el momento del envío** y construye un título y cuerpo seguros.
  - Se dispara con `after()` desde cada server action que puede crear avisos.
- **Tickets:** tablas propias (`tickets`, `ticket_messages`), **separadas de `messages`**, con RLS autor-o-`MANAGE_TICKETS` y tema Realtime `ticket:<id>`.
- **Reportes:** tabla `reports` con snapshot del texto, cola RLS para quien tenga `MANAGE_MESSAGES` en el canal y resolución por RPC.

**Tech Stack:** F2b + `web-push` (dependencia nueva, solo servidor) y un service worker estático `public/sw.js`. Antes de escribir el service worker o la suscripción, leer la guía de PWA/Web Push de `node_modules/next/dist/docs/`.

**Spec:** `docs/superpowers/specs/2026-10-16-f2-foro-design.md` (decisiones 10, 11, 12 y 21; "Web Push" y "Tiempo real" en *Mis decisiones*), con su padre `2026-10-16-plan-maestro.md`. F2a y F2b están hechas, incluida la ola final de correcciones de F2b.

## Global Constraints

- **Bits:**
  - `VIEW_CHANNEL` 1, `SEND_MESSAGES` 2, `SEND_IN_THREADS` 4, `MANAGE_MESSAGES` 8, `BAN_MEMBERS` 32 (global), `ADMINISTRATOR` 512, `EMBED_LINKS` 2048, `MENTION_EVERYONE` 4096, `MANAGE_TICKETS` 16384.
  - `channel_permissions(member, channel)` (solo bits de canal; admin → 31759) se usa **dentro de funciones definer** para evaluar a otro miembro. `authenticated` no puede ejecutarla.
  - `member_global_permissions(member)` se usa para bits globales.
- **Tipos de notificación** (`notifications.kind`):
  - mensajes: `mention`, `reply`, `channel_message`;
  - invitaciones: `invite_redeemed`, `godchild_banned`, `sponsor_penalized`;
  - moderación: `report_new`, `member_review`;
  - tickets: `ticket_new`, `ticket_reply`, `ticket_status`.
- **Una notificación por (destinatario, mensaje):**
  - Índice único parcial `(recipient_id, message_id) where message_id is not null`; las inserciones usan `on conflict do nothing`.
  - Prioridad dentro de un mensaje: `mention` > `reply` > `channel_message`. Se insertan en ese orden.
  - Al editar, solo reciben aviso los destinatarios **nuevos** de mención; nadie recibe dos (carry de F2b).
- **Reglas de fan-out de un mensaje** (raíz o respuesta, autor A, canal C):
  - El autor nunca se notifica a sí mismo.
  - Destinatario: miembro `active` con `channel_permissions(dest, C) & 1 = 1`.
  - `mention`:
    - `@miembro` con `notify=true`;
    - `@rol` y `@everyone` solo si la fila de `message_mentions` tiene `notify=true` (el autor tenía `MENTION_EVERYONE`). Se expanden a los miembros del rol o a todos los activos.
  - `reply`:
    - autor de la raíz;
    - autores de respuestas anteriores del mismo hilo;
    - autor del mensaje citado.
  - `channel_message`: solo mensajes **raíz**, para quienes tienen el nivel efectivo `all` en C.
  - El **nivel efectivo** de seguir es la fila de `channel_follow_prefs` si existe; si no, `channels.default_follow` (`'mentions'`, o `'all'` en *Anuncios*).
  - `mute` suprime `channel_message` y las menciones de `@rol`/`@everyone`. **No** suprime `@miembro` directo ni `reply` (estilo Discord; ruling F2c-R1).
- **Nunca se copia texto de un mensaje o ticket en `notifications`.** La bandeja lee el extracto con un join bajo RLS. La identidad del actor sale **siempre** de `members` (`display_name` o wallet corta), nunca de un `attrs.label` de mención (carry de F2b).
- **Push:**
  - **Payload:** `{title, body, url, tag}`.
  - **body:**
    - frase de identidad, del tipo `"<actor> te mencionó en #<canal>"`;
    - extracto de ≤ 80 caracteres entre «», solo si el destinatario **en el momento del envío** sigue viendo el canal y el mensaje no está borrado;
    - **sin extracto** en tickets: el ticket solo se identifica por su asunto.
  - **url:** siempre una ruta relativa interna, una de:
    - `/c/<canal>`;
    - `/c/<canal>?thread=<raíz>`;
    - `/tickets/<id>`;
    - `/u/<wallet>`;
    - `/moderation/reports`;
    - `/admin/members`.
  - El SW abre solo URLs del mismo origen.
- **Suscripciones push (anti-SSRF):** el endpoint debe ser `https:` y su host debe pertenecer a la allowlist:
  - `fcm.googleapis.com`
  - `updates.push.services.mozilla.com`
  - `*.notify.windows.com`
  - `web.push.apple.com`
  - `*.push.apple.com`

  Además: ≤ 10 suscripciones por miembro, borrando la más antigua. Las respuestas 404/410 borran la suscripción.
- **VAPID:**
  - Variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`mailto:` o `https:`), más `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
  - Las genera el implementador en `.env.local`, que **nunca se commitea**. En `.env.example` van vacías.
  - Sin claves, el despachador no hace nada y la UI oculta el interruptor de push.
- **Tickets:**
  - Solo en canales `kind='text'` con `tickets_enabled`. Para abrir uno hace falta VIEW + `SEND_MESSAGES` en el canal.
  - Ver y escribir:
    - el autor si sigue `active`, aunque pierda VIEW del canal;
    - quien tenga `MANAGE_TICKETS` (`channel_permissions & 16384`) en el canal del ticket.
  - Estados `open`/`closed`:
    - el autor o el staff cierran;
    - **solo el staff reabre**;
    - en un ticket cerrado no se escribe.
  - **Formato:** mensajes de **texto plano** de 1–4000 caracteres, sin imágenes ni menciones en F2c (ruling F2c-R2).
  - **Enlaces:** se muestran clicables por el guardián solo si el autor tenía `EMBED_LINKS` en el canal al escribir (`allow_links`).
  - **Límite:** ≤ 3 tickets abiertos por autor en total → `rate_limited`.
  - **Asunto:** 3–120 caracteres.
- **Reportes:**
  - Motivos `scam|spam|abuse|other`, con nota opcional ≤ 500.
  - Requisitos: VIEW del canal del mensaje y que el mensaje no sea propio ni esté borrado. Un reporte abierto por (mensaje, reportante) → `already_reported`.
  - **Límite:** ≤ 10 reportes por hora y miembro → `rate_limited`.
  - **Snapshot:** `author_id` + `left(body_text, 1000)`.
  - **Cola:** reportes de canales donde el lector tiene `MANAGE_MESSAGES`.
  - **Resolución** por RPC: `dismissed` o `actioned`, que resuelve todos los reportes abiertos del mismo mensaje. Borrar el mensaje usa la `deleteMessageAction` existente y banear usa el `BanDialog` de F1.
- **Realtime:**
  - Temas nuevos, privados:
    - `member:<uuid>`: autorizado si uuid = `current_member_id()`;
    - `ticket:<uuid>`: autorizado si `_can_access_ticket(uuid)`.
  - Cada política es propia y usa `CASE WHEN <regex estricto> THEN … ELSE false END` (ruling F2b-R3).
  - Payloads solo con IDs.
  - Sin política INSERT.
- **Errores nuevos** en `src/lib/errors.ts`, con copy en español de tú: `rate_limited`, `already_reported`, `ticket_closed`.
- **SQL:** convenciones de F1/F2. Todo lo definer con `search_path=''`, `revoke … from public, anon` y grants explícitos. Las tablas nuevas tienen RLS sin políticas de escritura. Los guards genéricos de pgTAP siguen verdes.
- **RLS eficiente:** usar `channel_id in (select v.id from public.visible_channels() v)`; nada de `can_view` por fila en tablas grandes.
- **UI:**
  - Ejecutar `search.py` antes de cada UI.
  - Tokens, ≥ 44px, foco visible, español de tú, 375px sin scroll horizontal, `prefers-reduced-motion`, sin BOM.
  - Rutas nuevas: `/notifications`, `/tickets`, `/tickets/[ticketId]` y `/moderation/reports`, con 404 real si un ticket no es accesible (igual que `/c`).
- **Despacho push tras cada acción que crea avisos:** se hace con `after(() => dispatchPendingPush())`. Afecta a post/edit message, Alpha, canje de invitación, baneo, reporte y abrir, escribir o cerrar ticket. El aviso de revisar sale del baneo. El despacho reclama como mucho 200 notificaciones de ≤ 15 minutos de antigüedad; las más viejas se marcan sin enviar.

## Review Focus

1. **Destinatario que pierde VIEW del canal** entre la creación del aviso y su lectura o envío: desaparece de la bandeja (RLS), el push no se envía y el contador no lo cuenta. *(Tasks 1, 2 y 6)*
2. **`@everyone` o `@rol` escrito por alguien sin `MENTION_EVERYONE`** → nadie recibe aviso. Con el permiso, solo lo reciben los miembros que ven el canal. *(Task 2)*
3. **Editar un mensaje** sin cambiar menciones, o añadiendo una → ningún aviso duplicado, y solo el nuevo mencionado recibe aviso. *(Task 2)*
4. **Ticket de A** → nunca es visible para B (no staff) por ninguna vía: select, Realtime, aviso, push ni contador. Tampoco para staff de **otro** canal. *(Tasks 5 y 6)*
5. **Suscripción push con endpoint `http://127.0.0.1/…` o de un host fuera de la allowlist** → rechazada al guardar (anti-SSRF). Un 410 al enviar → la suscripción se borra sin romper el despacho. *(Task 6)*

---

## Estructura de archivos

```
supabase/migrations/20261017300001_notifications.sql      # notifications, follow prefs, push_subscriptions, member topic
supabase/migrations/20261017300002_message_notify.sql     # fan-out de mensajes (post/edit wrappers)
supabase/migrations/20261017300003_social_notify.sql      # invitaciones, baneos, revisar
supabase/migrations/20261017300004_reports.sql
supabase/migrations/20261017300005_tickets.sql
supabase/migrations/20261017300006_push_dispatch.sql      # claim_push_notifications (service_role)
supabase/tests/300_notifications … 350_push_dispatch
src/lib/notifications/{queries,actions,realtime}.ts · src/lib/push/{dispatch,endpoint,client}.ts
src/lib/reports/{actions,queries}.ts · src/lib/tickets/{actions,queries,realtime}.ts
src/components/notifications/* · src/components/reports/* · src/components/tickets/*
public/sw.js
tests/unit/{notifications,push,reports,tickets}/** · tests/integration/realtime-{member,ticket}.test.ts · e2e/f2c-*.spec.ts
```

---

### Task 1: Esquema de notificaciones, seguir canales y suscripciones push

**Files:**
- Create: `supabase/migrations/20261017300001_notifications.sql`, `supabase/tests/300_notifications.test.sql`, `tests/integration/realtime-member.test.ts`

**Interfaces:**
- **Produces:**
  - `alter table channels add column default_follow text not null default 'mentions' check in ('all','mentions')`. La semilla pone *Anuncios* en `'all'`, localizada por nombre dentro de la categoría *Comunidad*, que es la semilla de F2a.
  - `notifications`:
    - `id bigint identity pk`, `recipient_id` → members cascade, `kind text check (Global Constraints)`, `actor_id` → members null
    - `channel_id` → channels cascade null, `message_id` → messages cascade null, `ticket_id uuid null` (la FK la añade la Task 5)
    - `data jsonb not null default '{}'`: solo IDs o flags, nunca texto de usuario
    - `created_at`, `read_at`, `pushed_at`
    - Índices: `(recipient_id, created_at desc)`, el único parcial `(recipient_id, message_id) where message_id is not null` y `(created_at) where pushed_at is null`.
  - `channel_follow_prefs`: `(member_id, channel_id)` pk, `level text check in ('all','mentions','mute')`.
  - `push_subscriptions`: `id uuid`, `member_id` cascade, `endpoint text unique`, `p256dh`, `auth`, `created_at`, `last_used_at`.
  - **RLS:**
    - `notifications` SELECT con `recipient_id = current_member_id() and (channel_id is null or channel_id in (select v.id from visible_channels() v))`. La Task 5 la amplía para `ticket_id`.
    - `channel_follow_prefs` y `push_subscriptions`: solo las propias, sin escritura directa.
  - **RPCs (authenticated):**
    - `set_channel_follow(p_channel uuid, p_level text) returns void`: requiere VIEW y canal `text`; si `p_level` coincide con `default_follow`, borra la fila.
    - `my_channel_follow(p_channel uuid) returns text`: nivel efectivo.
    - `public._follow_level(p_member uuid, p_channel uuid) returns text`: helper definer, sin grant a authenticated.
    - `mark_notifications_read(p_ids bigint[] default null) returns int`: null = todas las propias.
    - `my_unread_notification_count() returns int`: aplica el mismo filtro de visibilidad que la RLS.
    - `save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void`:
      - valida el endpoint con la allowlist de Global Constraints (regex de host en SQL; error `invalid_input`);
      - upsert por endpoint, reasignando el miembro;
      - recorta a 10 por miembro.
    - `delete_push_subscription(p_endpoint text) returns void`: solo las propias.
  - **Realtime:**
    - Trigger AFTER INSERT en `notifications` → `realtime.send({id}, 'notification_created', 'member:'||recipient_id, true)`.
    - Política `realtime_receive_member_topics` con CASE y regex `^member:<uuid>$` → `substring(...)::uuid = current_member_id()`.

- [ ] **Step 1: pgTAP**
  - Estructura y RLS: B no ve los avisos de A, y un aviso de un canal que A ya no ve desaparece del select y del contador.
  - Seguir canales:
    - nivel por defecto `mentions`, y `all` en *Anuncios*;
    - con `set_channel_follow` a un canal oculto → `forbidden`;
    - volver al valor por defecto borra la fila.
  - Lectura: `mark_notifications_read` solo marca las propias.
  - Push:
    - endpoints `http://…`, `https://127.0.0.1/…` y `https://evil.com/…` → `invalid_input`;
    - con FCM, OK;
    - la undécima suscripción borra la más antigua.
  - anon sin EXECUTE.
- [ ] **Step 2: integración**
  - A recibe `notification_created` en `member:<A>`.
  - B, al suscribirse a `member:<A>`, no recibe nada.
  - Usar el patrón y los helpers de `tests/integration/realtime-messages.test.ts`.
- [ ] **Step 3:** RED → implementar → GREEN (`pnpm db:test`, `pnpm test`).
- [ ] **Step 4:** Commit `feat(notify): notifications, follow prefs and push subscriptions schema`.

### Task 2: Fan-out de avisos de mensajes

**Files:**
- Create: `supabase/migrations/20261017300002_message_notify.sql`, `supabase/tests/310_message_notify.test.sql`

**Interfaces:**
- **Consumes:** Task 1 (`notifications`, `_follow_level`) y F2b (`message_mentions`, `_post_message_core`, `edit_message`).
- **Produces:**
  - `public._notify_message(p_message uuid, p_only_mentions boolean) returns void`:
    - definer, sin grant;
    - aplica las reglas de fan-out de Global Constraints en el orden de prioridad;
    - con `p_only_mentions=true` solo evalúa `mention`, que es el caso de la edición.
  - `create or replace` de `post_message` y `post_message_as`: misma firma; tras el core llaman a `_notify_message(v_id, false)`.
  - `create or replace` de `edit_message`: misma firma y lógica; al final llama a `_notify_message(p_id, true)`.
  - Los avisos `mention`/`reply` llevan `channel_id`, `message_id` y `actor_id`, y `data = {thread_root_id}` si es respuesta.

- [ ] **Step 1: pgTAP, un caso por regla**
  - Menciones:
    - `@miembro` que ve el canal → 1 aviso `mention`;
    - `@miembro` que **no** ve el canal → 0;
    - `@everyone` sin 4096 → 0 avisos;
    - `@everyone` con 4096 → todos los activos que ven el canal menos el autor; un baneado no lo recibe;
    - `@rol` → solo los miembros del rol que ven el canal.
  - Respuestas:
    - una respuesta notifica `reply` al autor de la raíz y a los participantes previos;
    - citar notifica `reply` al citado.
  - Seguir canales:
    - `all` → `channel_message` solo en raíces, no en respuestas;
    - `mute` → sin `channel_message` ni `@everyone`, pero sí `@miembro` directo y `reply`.
  - Duplicados y edición:
    - mención + respuesta al mismo destinatario → 1 aviso, de tipo `mention`;
    - editar sin cambios → 0 nuevos;
    - editar añadiendo `@C` → 1 nuevo, para C.
  - El autor nunca se notifica a sí mismo.
- [ ] **Step 2:** RED → implementar → GREEN. Los tests de F2b `210`/`220` siguen verdes.
- [ ] **Step 3:** Commit `feat(notify): message mention, reply and follow fan-out`.

### Task 3: Avisos de invitaciones y de moderación de miembros

**Files:**
- Create: `supabase/migrations/20261017300003_social_notify.sql`, `supabase/tests/320_social_notify.test.sql`

**Interfaces:**
- **Consumes:** Task 1 y las tablas de F1 (`invite_redemptions`, `invites.created_by`, `bans`, `members.needs_review_since`).
- **Produces:** triggers definer, **sin tocar las funciones de F1**:
  - AFTER INSERT en `invite_redemptions` → `invite_redeemed` para `invites.created_by`, con `actor_id` = el nuevo miembro.
  - AFTER INSERT en `bans` → al `sponsor_member_id`, si existe y está activo:
    - `sponsor_penalized` si `sponsor_penalized`;
    - si no, `godchild_banned`, con `actor_id` = el baneado.
  - AFTER UPDATE OF `needs_review_since` (de null a no null) en `members` → `member_review` para cada miembro activo con `member_global_permissions & (32|512) <> 0`, con `actor_id` = el miembro marcado.
  - Los destinatarios y la relación de padrino salen de `invited_by_member_id` y `sponsor_member_id`, **nunca del nombre del rol Padrino** (carry de F2a: `system_key`).

- [ ] **Step 1: pgTAP**
  - Al canjear una invitación, el creador recibe 1 `invite_redeemed`.
  - Un baneo sin penalización da `godchild_banned` al padrino; con penalización, `sponsor_penalized`.
  - Los ahijados del baneado marcados para revisar generan `member_review` para el staff con BAN o admin, y nada para miembros normales.
- [ ] **Step 2:** RED → implementar → GREEN.
- [ ] **Step 3:** Commit `feat(notify): invite and member-review notices`.

### Task 4: Reportes de mensajes

**Files:**
- Create: `supabase/migrations/20261017300004_reports.sql`, `supabase/tests/330_reports.test.sql`
- Modify: `src/lib/errors.ts` (`rate_limited`, `already_reported`, `ticket_closed`)

**Interfaces:**
- **Produces:**
  - `reports`:
    - `id uuid`, `message_id` → messages `on delete set null`, `channel_id` → channels cascade, `reporter_id` → members
    - `reason check in ('scam','spam','abuse','other')`, `note text check ≤500`
    - `snapshot_author_id` → members, `snapshot_text text`
    - `status check in ('open','dismissed','actioned') default 'open'`, `resolved_by`, `resolved_at`, `created_at`
    - Único parcial `(message_id, reporter_id) where status='open'`; índice `(channel_id, status, created_at desc)`.
  - **RLS SELECT:** `channel_id in (select v.id from visible_channels() v) and public.can(channel_id, 8)`.
  - `report_message(p_message uuid, p_reason text, p_note text) returns uuid`:
    - aplica las reglas de Global Constraints;
    - notifica `report_new` (con `channel_id` y `data={report_id}`, **sin** `message_id` para no chocar con el índice único) a cada miembro activo con `channel_permissions(m, canal) & 8`, salvo el reportante.
  - `resolve_report(p_report uuid, p_status text) returns int`:
    - requiere `can(canal, 8)`;
    - `p_status in ('dismissed','actioned')`;
    - marca **todos** los reportes abiertos del mismo `message_id` (o solo ese, si `message_id` es null);
    - audita en `audit_log` y devuelve el número de reportes resueltos.

- [ ] **Step 1: pgTAP**
  - Reportar un mensaje propio, borrado o de un canal oculto → `forbidden`.
  - Reportar dos veces → `already_reported`.
  - El reporte número 11 en una hora → `rate_limited`.
  - Cola: un miembro normal no ve ningún reporte; el moderador con 8 en ese canal sí; un moderador sin 8 en ese canal (overwrite deny) no.
  - El staff recibe `report_new`.
  - `resolve_report` sin permiso → `forbidden`.
  - Al borrar el mensaje, el reporte conserva su snapshot.
- [ ] **Step 2:** RED → implementar → GREEN.
- [ ] **Step 3:** Commit `feat(reports): message reports with moderation queue`.

### Task 5: Tickets privados

**Files:**
- Create: `supabase/migrations/20261017300005_tickets.sql`, `supabase/tests/340_tickets.test.sql`, `tests/integration/realtime-ticket.test.ts`

**Interfaces:**
- **Produces:**
  - `tickets`:
    - `id uuid`, `channel_id` → channels cascade, `author_id` → members, `subject text check 3–120`
    - `status check in ('open','closed') default 'open'`, `closed_by`, `closed_at`
    - `last_message_at`, `created_at`
    - Índices `(author_id, status)` y `(channel_id, status, last_message_at desc)`.
  - `ticket_messages`: `id uuid`, `ticket_id` cascade, `author_id`, `body_text text check 1–4000 after btrim`, `allow_links bool`, `created_at`; índice `(ticket_id, created_at)`.
  - FK `notifications.ticket_id` → tickets cascade.
  - `public._can_access_ticket(p_ticket uuid) returns boolean`: definer, grant authenticated; aplica la regla de Global Constraints para `current_member_id()`.
  - `public._member_can_access_ticket(p_member uuid, p_ticket uuid) returns boolean`: sin grant; lo usan el fan-out y el push.
  - **RLS SELECT:**
    - `tickets`: `author_id = current_member_id() or public.can(channel_id, 16384)`; el autor debe estar activo, que ya lo garantiza `current_member_id`/`is_active_member`.
    - `ticket_messages`: vía `ticket_id in (select id from tickets)`, heredando la RLS.
    - `notifications`: amplía su política añadiendo `and (ticket_id is null or public._can_access_ticket(ticket_id))`.
  - **RPCs:**
    - `open_ticket(p_channel uuid, p_subject text, p_body text) returns uuid`: aplica las reglas y crea el primer mensaje.
    - `post_ticket_message(p_ticket uuid, p_body text) returns uuid`: falla con `ticket_closed` si el ticket está cerrado.
    - `set_ticket_status(p_ticket uuid, p_status text) returns void`: el autor solo puede cerrar; el staff cierra o reabre.
  - **Avisos:**
    - `ticket_new` → staff con 16384 en el canal;
    - `ticket_reply` → si escribe el autor, al staff que ya participó (o a todo el staff del canal si nadie respondió); si escribe el staff, al autor;
    - `ticket_status` → al autor cuando el staff cierra o reabre, y al staff que participó cuando cierra el autor.

    Todos llevan `ticket_id` y `actor_id`, pero **no** `channel_id`, para que la RLS de canal no oculte el ticket al autor que perdió VIEW.
  - **Realtime:**
    - Triggers en `ticket_messages` (insert) y `tickets` (update) → `ticket_message_created` / `ticket_updated`, con payload `{id, ticket_id}`, al tema `ticket:<id>`.
    - Política `realtime_receive_ticket_topics` con CASE + regex + `_can_access_ticket`.

- [ ] **Step 1: pgTAP**
  - Abrir:
    - en un canal sin `tickets_enabled` → `forbidden`;
    - el cuarto ticket abierto → `rate_limited`.
  - Acceso:
    - B (no staff) no ve el ticket de A, ni sus mensajes, ni sus avisos;
    - un Soporte con 16384 en el canal sí;
    - un Soporte con 16384 denegado por overwrite en ese canal no;
    - si A pierde VIEW del canal, sigue viendo su ticket y su aviso.
  - Estados:
    - escribir en un ticket cerrado → `ticket_closed`;
    - si el autor intenta reabrir → `forbidden`.
  - Avisos correctos en cada transición.
- [ ] **Step 2: integración**
  - A y el staff reciben en `ticket:<id>`; B no.
- [ ] **Step 3:** RED → implementar → GREEN.
- [ ] **Step 4:** Commit `feat(tickets): private support tickets with realtime`.

### Task 6: Despacho de Web Push

**Files:**
- Create: `supabase/migrations/20261017300006_push_dispatch.sql`, `supabase/tests/350_push_dispatch.test.sql`
- Create: `src/lib/push/{endpoint,dispatch}.ts`, `public/sw.js`, `tests/unit/push/{endpoint,dispatch}.test.ts`
- Modify: `.env.example` y `package.json` (`web-push` y `@types/web-push`); `.env.local` en local, **nunca commiteado**.
- Modify: las server actions que crean avisos (`src/lib/chat/actions.ts`, `src/lib/chat/alpha.ts`, la de canje de invitación, `src/lib/moderation/actions.ts`), añadiendo `after(() => dispatchPendingPush())`.

**Interfaces:**
- **Consumes:** Tasks 1–5.
- **Produces:**
  - `public.claim_push_notifications(p_limit int default 200) returns table(notification_id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)`:
    - solo `service_role`;
    - toma con `for update skip locked` las que tienen `pushed_at is null` y `created_at > now() - 15 min`, y les pone `pushed_at = now()`;
    - marca también, sin devolverlas, las más viejas;
    - **revalida** en ese momento:
      - destinatario activo;
      - `channel_permissions(dest, canal) & 1` si hay canal;
      - `_member_can_access_ticket` si hay ticket;
      - para `report_new`, que el destinatario siga teniendo 8 en el canal;
      - para `member_review`, que siga teniendo 32 o 512.
    - Lo que no pasa se marca y no se devuelve.
    - Construye `title`, `body` y `url` según Global Constraints, con frases en español (p. ej. `"Nueva mención"` / `"<actor> te mencionó en #<canal>: «…»"`).
    - Devuelve una fila por cada suscripción del destinatario.
  - `public.delete_push_subscription_by_endpoint(p_endpoint text)`: solo `service_role`.
  - `src/lib/push/endpoint.ts`: `isAllowedPushEndpoint(url: string): boolean`, el espejo TS de la allowlist SQL.
  - `src/lib/push/dispatch.ts` (`server-only`):
    - `dispatchPendingPush(): Promise<{sent: number; removed: number}>`;
    - no hace nada si faltan las claves VAPID;
    - usa el cliente admin;
    - `webpush.sendNotification` con `TTL: 3600` y `urgency: 'high'` para menciones;
    - con 404/410 → `delete_push_subscription_by_endpoint`;
    - cualquier otro error se registra con `console.error` sin el endpoint completo y nunca lanza.
  - `public/sw.js`:
    - `push` → `showNotification(title, {body, tag, data:{url}, icon:'/favicon.ico'})`;
    - `notificationclick` → enfoca o abre `new URL(url, self.location.origin)` solo si `origin` coincide.

- [ ] **Step 1: pgTAP**
  - Un aviso de un canal que el destinatario perdió → no se devuelve y queda marcado.
  - Un aviso de un ticket no accesible → idem.
  - Un aviso de hace 20 minutos → marcado y no devuelto.
  - Un segundo claim → 0 filas.
  - El extracto tiene ≤ 80 caracteres y no aparece si el mensaje está borrado.
  - El nombre del actor sale de `members`, también cuando el mensaje contiene una mención con `label` falso (`"SuperAdmin"`) del tipo `"<label> te mencionó"`. Assert: el título y la frase de identidad no contienen el label.
  - authenticated no puede ejecutar `claim_push_notifications`.
- [ ] **Step 2: unit**
  - `isAllowedPushEndpoint`, con la misma tabla de casos que el pgTAP.
  - `dispatchPendingPush`, con `web-push` y el cliente admin mockeados:
    - envía una vez por fila;
    - un 410 → borra la suscripción;
    - sin VAPID → 0 llamadas.
- [ ] **Step 3:** Generar las claves con `pnpm exec web-push generate-vapid-keys --json` y escribirlas con la herramienta Write en `.env.local`, junto con `VAPID_SUBJECT=mailto:admin@elclublambo.local`. Comprobar con `git status` que `.env.local` sigue ignorado.
- [ ] **Step 4:** RED → implementar → GREEN, más `pnpm build`.
- [ ] **Step 5:** Commit `feat(push): web push dispatch with send-time visibility checks`.

### Task 7: Bandeja, campana, seguir canal y activar push (UI)

**Files:**
- Create: `src/lib/notifications/{queries,actions,realtime}.ts`, `src/lib/push/client.ts`
- Create: `src/components/notifications/{notification-bell,notification-list,notification-item,follow-menu,push-toggle}.tsx`
- Create: `src/app/(forum)/notifications/page.tsx`
- Modify:
  - `src/components/shell/sidebar.tsx` y `topbar.tsx`: la campana con contador, también en móvil.
  - La cabecera de `/c/[channelId]`: el `FollowMenu`.
  - `chat-view.tsx`: abrir el hilo desde `?thread=<rootId>`.
- Test: `tests/unit/notifications/**`

**Interfaces:**
- **Consumes:** las RPCs de las Tasks 1, 5 y 6.
- **Produces:**
  - `listNotifications({cursor?: {createdAt: string; id: number}, filter: 'all'|'mentions'}): Promise<NotificationView[]>`:
    - lee bajo RLS y hace join, también bajo RLS, a `members` (actor), `channels` (nombre), `messages` (`body_text` → extracto de 140 caracteres, solo si no está borrado) y `tickets` (asunto);
    - páginas de 30.
  - `NotificationView`: `{id; kind; createdAt; readAt; actor: {name; wallet} | null; channelName: string | null; excerpt: string | null; ticketSubject: string | null; href: string}`.
  - Server actions:
    - `markNotificationsReadAction(ids: number[] | null)`;
    - `setChannelFollowAction(channelId, level)`;
    - `savePushSubscriptionAction(sub: {endpoint; keys:{p256dh; auth}})`;
    - `deletePushSubscriptionAction(endpoint)`.
  - `useNotificationEvents(memberId, onCreated)`: tema `member:<id>`, con el mismo patrón de unión, salida y reintento que `src/lib/chat/realtime.ts`.
  - **Copy por tipo**, en español de tú y con la identidad desde `actor`. Ejemplos:
    - "**X** te mencionó en #trading";
    - "**X** respondió en un hilo de #general";
    - "**X** canjeó tu invitación";
    - "Han baneado a tu ahijado **X**";
    - "Has perdido el permiso de invitar porque baneamos a **X**";
    - "Nuevo reporte en #trading";
    - "**X** está marcado para revisar";
    - "Nuevo ticket: <asunto>";
    - "Respuesta en tu ticket <asunto>";
    - "Ticket <asunto> cerrado/reabierto".
  - **Push toggle:**
    - solo se muestra si existen `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `'serviceWorker' in navigator` y `'PushManager' in window`;
    - registra `/sw.js`, pide permiso **solo al pulsar** y se suscribe con `userVisibleOnly: true`;
    - estado denegado → texto que explica cómo reactivarlo en el navegador.

- [ ] **Step 1:** `search.py` (ux + nextjs) y anotar lo aplicado.
- [ ] **Step 2: unit (RTL)**
  - El copy y el `href` de cada tipo.
  - El ítem no leído tiene marca e `aria-label` con "sin leer".
  - "Marcar todo como leído".
  - La campana muestra "9+" por encima de 9, incrementa con un evento simulado y no muestra nada con 0.
  - El `FollowMenu` refleja el nivel efectivo y llama a la action.
  - El push toggle se oculta sin soporte o sin clave.
  - El `href` de una respuesta es `/c/<canal>?thread=<raíz>`, y `chat-view` abre ese hilo.
- [ ] **Step 3:** RED → implementar → GREEN, más `pnpm build`.
- [ ] **Step 4:** Commit `feat(notify): inbox, bell, channel follow menu and push opt-in`.

### Task 8: Reportar y cola de moderación (UI)

**Files:**
- Create: `src/lib/reports/{actions,queries}.ts`, `src/components/reports/{report-dialog,report-queue}.tsx`, `src/app/(forum)/moderation/reports/page.tsx`
- Modify:
  - `src/components/chat/message-item.tsx`: sustituir el ítem "Próximamente" por "Reportar", que abre `ReportDialog`.
  - `sidebar.tsx`: enlace "Reportes", visible si `my_permissions` tiene 8 o 512, o si el miembro tiene 8 en algún canal. Para lo último usar `exists` sobre `my_channel_permissions` de los canales visibles, o una RPC nueva `has_any_channel_perm(p_bit bigint) returns boolean`, definida en esta task con su pgTAP en `330_reports`.
- Test: `tests/unit/reports/**`

**Interfaces:**
- **Consumes:** Task 4, `deleteMessageAction` (F2b) y `BanDialog` (`src/components/members/ban-dialog.tsx`).
- **Produces:**
  - `reportMessageAction(messageId, reason, note)`.
  - `resolveReportAction(reportId, status)`.
  - `listReportQueue(status: 'open'|'closed')`: agrupada por mensaje, con contador, motivos, snapshot y enlace al canal.
  - Acciones de la cola:
    - "Borrar mensaje": `deleteMessageAction` y luego `resolve 'actioned'`;
    - "Banear autor": abre `BanDialog` (solo con `BAN_MEMBERS`) y al confirmar `resolve 'actioned'`;
    - "Descartar".
  - La página da 404 si el lector no tiene 8 en ningún canal.

- [ ] **Step 1:** `search.py`.
- [ ] **Step 2: unit**
  - El diálogo valida el motivo obligatorio, la nota ≤ 500 y los errores `already_reported`/`rate_limited`, mostrando su copy.
  - La cola agrupa por mensaje, muestra el snapshot aunque el mensaje esté borrado y aplica la secuencia de acciones correcta.
- [ ] **Step 3:** RED → implementar → GREEN, más `pnpm build`.
- [ ] **Step 4:** Commit `feat(reports): report dialog and moderation queue`.

### Task 9: Tickets (UI)

**Files:**
- Create: `src/lib/tickets/{actions,queries,realtime}.ts`, `src/components/tickets/{open-ticket-dialog,ticket-list,ticket-view,ticket-composer}.tsx`
- Create: `src/app/(forum)/tickets/page.tsx`, `src/app/(forum)/tickets/[ticketId]/page.tsx`
- Modify:
  - La cabecera de `/c/[channelId]`: botón "Abrir ticket" si `tickets_enabled` y el miembro tiene `SEND_MESSAGES`.
  - `sidebar.tsx`: enlace "Tickets" para todos los miembros, con el contador de tickets abiertos.
  - `src/proxy.ts`: 404 real para `/tickets/<inaccesible|inexistente>` con el cliente RLS, igual que `/c`.
- Test: `tests/unit/tickets/**`

**Interfaces:**
- **Consumes:** Task 5 y el renderizado de enlaces del guardián (`src/lib/chat/links.ts`), aplicado a texto plano con `allow_links`.
- **Produces:**
  - `openTicketAction`, `postTicketMessageAction` y `setTicketStatusAction`.
  - `listTickets({scope: 'mine'|'staff', status})`.
  - `getTicket(id)`.
  - `useTicketEvents(ticketId, handlers)`.
  - **Vista del ticket:**
    - mensajes lineales con la etiqueta "Staff" en quien tiene 16384;
    - compositor de texto plano (Enter envía, Shift+Enter nueva línea, contador de 4000);
    - cerrar y reabrir según el rol;
    - banner "Ticket cerrado" que deshabilita el compositor.
  - La lista muestra las pestañas "Mis tickets" y, para el staff, "Bandeja de soporte", con filtro abierto/cerrado.

- [ ] **Step 1:** `search.py`.
- [ ] **Step 2: unit**
  - Validación del asunto y del cuerpo.
  - Los enlaces de un autor sin `allow_links` salen como texto.
  - Un ticket cerrado deshabilita el compositor.
  - El autor no ve "Reabrir".
  - Un evento realtime añade el mensaje tras releer.
- [ ] **Step 3:** RED → implementar → GREEN, más `pnpm build`.
- [ ] **Step 4:** Commit `feat(tickets): ticket list, view and open dialog`.

### Task 10: E2E de F2c y capturas

**Files:**
- Create: `e2e/f2c-notify.spec.ts`, `e2e/f2c-support.spec.ts`
- Modify: `e2e/screens.spec.ts` (`@screens` de `/notifications`, `/tickets/[id]` y `/moderation/reports` a 375 y 1440)

- [ ] **Step 1: escenarios con wallets de prueba generadas**
  1. B menciona a A → la campana de A sube sin recargar, el ítem lleva a `/c/<canal>` y al abrirlo baja el contador.
  2. A pone *Trading* en "Silencio" → un mensaje raíz de B no notifica. Con "Todo" sí notifica.
  3. B reporta un mensaje de C → el moderador lo ve en la cola, lo borra y el reporte pasa a cerrado. Un miembro normal recibe 404 en `/moderation/reports`.
  4. B abre un ticket en *Soporte Técnico* → el staff recibe el aviso y responde, y B ve la respuesta sin recargar. C (no staff) recibe 404 en `/tickets/<id>`. El staff cierra el ticket y B ya no puede escribir.
  5. Push: con permiso concedido en el contexto de Playwright (`context.grantPermissions(['notifications'])`), el toggle crea una fila en `push_subscriptions`. Esto **no** depende de que llegue un push real.
- [ ] **Step 2:** Pasar las suites completas (`lint`, `typecheck`, `test`, `db:test`, `build` y `test:e2e`, más `@screens` con `SCREENS=1`) y revisar las capturas a 375 y 1440.
- [ ] **Step 3:** Commit `test(e2e): f2c notifications, reports and tickets acceptance`.
