-- F3b Task 5: the tip read RPCs return exact amounts and the own-anonymous flag.
-- * numeric(78,0) travels as a JSON number through PostgREST and loses digits past 2^53 in JavaScript, so every
--   amount/total also comes back as text (`amount_text`, `total_text`); clients read those.
-- * `anonymous` lets the donor see their own anonymous tips marked "(tú, anónimo)". For anyone else the donor is
--   still null on an anonymous tip, so the flag adds nothing they did not already see.
-- New columns are appended, so existing callers that select the old ones keep working.
drop function public.tips_summary(uuid[]);
drop function public.message_tips(uuid);
drop function public.member_tips(uuid, int);

create function public.tips_summary(p_message_ids uuid[])
returns table (message_id uuid, token text, total numeric, tip_count int, total_text text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.message_id, t.token, sum(t.amount), count(*)::int, sum(t.amount)::text
  from public.tips t
  join public.messages m on m.id = t.message_id and m.deleted_at is null
  where public.is_active_member()
    and t.message_id = any (p_message_ids)
    and m.channel_id in (select v.id from public.visible_channels() v)
  group by t.message_id, t.token
$$;

create function public.message_tips(p_message_id uuid)
returns table (tip_id uuid, donor_id uuid, is_me boolean, token text, amount numeric, chain_id int,
               main_tx_hash text, created_at timestamptz, amount_text text, anonymous boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         case when t.anonymous and t.from_member <> public.current_member_id() then null else t.from_member end,
         t.from_member = public.current_member_id(),
         t.token, t.amount, t.chain_id, t.main_tx_hash, t.created_at, t.amount::text, t.anonymous
  from public.tips t
  join public.messages m on m.id = t.message_id and m.deleted_at is null
  where public.is_active_member()
    and t.message_id = p_message_id
    and m.channel_id in (select v.id from public.visible_channels() v)
  order by t.created_at desc, t.id
$$;

create function public.member_tips(p_member uuid, p_limit int default 20)
returns table (tip_id uuid, donor_id uuid, is_me boolean, token text, amount numeric, chain_id int,
               main_tx_hash text, created_at timestamptz, amount_text text, anonymous boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         case when t.anonymous and t.from_member <> public.current_member_id() then null else t.from_member end,
         t.from_member = public.current_member_id(),
         t.token, t.amount, t.chain_id, t.main_tx_hash, t.created_at, t.amount::text, t.anonymous
  from public.tips t
  left join public.messages m on m.id = t.message_id
  where public.is_active_member()
    and t.to_member = p_member
    and (t.target_type = 'profile'
         or (m.id is not null and m.deleted_at is null
             and m.channel_id in (select v.id from public.visible_channels() v)))
  order by t.created_at desc, t.id
  limit greatest(1, least(100, coalesce(p_limit, 20)))
$$;

-- The transaction behind a system notice (explorer link). Reachable only through the notice the caller can read, so
-- it exposes nothing beyond what message_tips already shows for a visible message.
create function public.tips_by_ids(p_tip_ids uuid[])
returns table (tip_id uuid, chain_id int, main_tx_hash text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.chain_id, t.main_tx_hash
  from public.tips t
  join public.messages n on n.tip_id = t.id and n.kind = 'system' and n.deleted_at is null
  where public.is_active_member()
    and t.id = any (p_tip_ids)
    and n.channel_id in (select v.id from public.visible_channels() v)
$$;

revoke execute on function
  public.tips_summary(uuid[]),
  public.message_tips(uuid),
  public.member_tips(uuid, int),
  public.tips_by_ids(uuid[])
from public, anon, authenticated, service_role;

grant execute on function
  public.tips_summary(uuid[]),
  public.message_tips(uuid),
  public.member_tips(uuid, int),
  public.tips_by_ids(uuid[])
to authenticated;
