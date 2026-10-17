-- F2b re-review fixes to the mention walk of 20261016200006:
--   * descend only from nodes whose `type` is a JSON string. `->> 'type'` turns a number, boolean, object or array
--     into text ('1', 'true', '{"x": 1}'), which none of the stop rules matched, so SQL walked subtrees that the
--     sanitizer (content.ts convert: `typeof type !== "string"` -> dropped) never renders: ghost pings.
--   * the other divergence (the sanitizer's node budget) is closed on the TS side: MAX_DOC_NODES is now above what a
--     65536-byte body can produce (see the comment in src/lib/chat/content.ts).
-- Parity cases: tests/fixtures/mention-parity.json (TS unit + tests/integration/mention-parity.test.ts) and
-- supabase/tests/255_mention_walk.test.sql.
--
-- Storage note (chat_images_select, 20261016200006): an uploader keeps reading their own unattached objects after
-- losing VIEW on the channel. Accepted: it is their own upload, nobody else gains access, and a banned (non-active)
-- uploader is cut off; orphan objects are swept by the service role (F5 checklist, ruling R10).

create or replace function public._insert_mentions(p_message uuid, p_body jsonb, p_perms bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  with recursive walk(node, depth, ord) as (
    select p_body, 0, array[]::bigint[]
    union all
    select c.value, w.depth + 1, w.ord || c.i
    from walk w
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(w.node) = 'object' and jsonb_typeof(w.node -> 'type') = 'string'
                and jsonb_typeof(w.node -> 'content') = 'array'
           then w.node -> 'content' else '[]'::jsonb end
    ) with ordinality as c(value, i)
    where w.depth < 40
      and jsonb_typeof(w.node -> 'type') = 'string'
      and (w.node ->> 'type') not in ('text', 'mention', 'hardBreak', 'codeBlock', 'horizontalRule')
      and not (w.node ->> 'type' = 'table' and c.value ->> 'type' is distinct from 'tableRow')
      and not (w.node ->> 'type' = 'tableRow' and coalesce(c.value ->> 'type', '') not in ('tableCell', 'tableHeader'))
  ),
  raw as (
    select w.node -> 'attrs' ->> 'kind' as kind, w.node -> 'attrs' ->> 'id' as id, w.ord
    from walk w
    where jsonb_typeof(w.node) = 'object' and w.node ->> 'type' = 'mention'
  ),
  norm as (
    select r.kind,
           case when r.kind = 'everyone' then null else r.id::uuid end as target,
           r.ord
    from raw r
    where r.kind = 'everyone'
       or (r.kind in ('member', 'role')
           and r.id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  ),
  uniq as (
    select distinct on (kind, target) kind, target, ord from norm order by kind, target, ord
  ),
  resolved as (
    select u.kind, u.target, true as notify, u.ord
    from uniq u join public.members m on m.id = u.target and m.status = 'active'
    where u.kind = 'member'
    union all
    select u.kind, u.target, (p_perms & 4096) = 4096, u.ord
    from uniq u join public.roles ro on ro.id = u.target
    where u.kind = 'role'
    union all
    select u.kind, u.target, (p_perms & 4096) = 4096, u.ord
    from uniq u where u.kind = 'everyone'
  )
  insert into public.message_mentions (message_id, kind, target_id, notify)
  select p_message, r.kind, r.target, r.notify from resolved r order by r.ord limit 50
$$;

revoke execute on function public._insert_mentions(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
