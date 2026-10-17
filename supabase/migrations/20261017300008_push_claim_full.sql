-- The claim reports how many notices it picked (`picked`, same value on every row), so the dispatcher can tell a full
-- batch from a partial one even when the picked notices have no subscription or are no longer valid.
--  * every picked AND valid notice returns at least one row; recipients without subscriptions give one row with null
--    endpoint/p256dh/auth (skipped by the dispatcher);
--  * invalid or stale notices return no row of their own (still marked as pushed);
--  * if notices were picked but none is valid, one sentinel row (notification_id null) carries `picked`.

drop function public.claim_push_notifications(int);

create function public.claim_push_notifications(p_limit int default 200)
returns table (
  notification_id bigint,
  endpoint text,
  p256dh text,
  auth text,
  title text,
  body text,
  url text,
  tag text,
  picked int
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 200));
begin
  update public.notifications n
  set pushed_at = now()
  where n.pushed_at is null
    and n.created_at <= now() - interval '15 minutes';

  return query
  with picked as (
    select n.id
    from public.notifications n
    where n.pushed_at is null
      and n.created_at > now() - interval '15 minutes'
    order by n.id
    limit v_limit
    for update skip locked
  ),
  claimed as (
    update public.notifications n
    set pushed_at = now()
    from picked
    where n.id = picked.id
    returning n.id, n.recipient_id
  ),
  total as (select count(*)::int as c from claimed),
  built as (
    select c.id as nid, c.recipient_id as rid, b.title as btitle, b.body as bbody, b.url as burl, b.tag as btag
    from claimed c
    cross join lateral public._push_build(c.id) b
  ),
  rows_ as (
    select b.nid, s.endpoint as ep, s.p256dh as pk, s.auth as ak, b.btitle, b.bbody, b.burl, b.btag, s.created_at as sca, s.id as sid
    from built b
    left join public.push_subscriptions s on s.member_id = b.rid
  )
  select r.nid, r.ep, r.pk, r.ak, r.btitle, r.bbody, r.burl, r.btag, t.c
  from rows_ r
  cross join total t
  union all
  select null::bigint, null::text, null::text, null::text, null::text, null::text, null::text, null::text, t.c
  from total t
  where t.c > 0 and not exists (select 1 from built)
  order by 1, 2;
end;
$$;

revoke execute on function public.claim_push_notifications(int) from public, anon, authenticated, service_role;
grant execute on function public.claim_push_notifications(int) to service_role;
