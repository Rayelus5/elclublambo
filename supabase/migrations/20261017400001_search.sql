-- F2d: accent-insensitive full-text search. The RPCs are SECURITY INVOKER on purpose:
-- visibility comes only from the existing RLS on messages (visible_channels()) and members.

create extension if not exists unaccent with schema extensions;

-- unaccent() is only STABLE; this wrapper pins the dictionary so it can back a generated column and an index.
create function public.f_unaccent(text)
returns text
language sql
immutable parallel safe strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

alter table public.messages
  add column search_tsv tsvector
  generated always as (to_tsvector('simple'::regconfig, public.f_unaccent(body_text))) stored;

create index messages_search_idx on public.messages using gin (search_tsv);

-- User text -> prefix tsquery. Only letter/digit runs survive, so no tsquery syntax can reach to_tsquery.
-- Returns null when there is nothing useful to search for.
create function public._search_tsquery(p_q text)
returns tsquery
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_terms text[];
  v_q tsquery;
begin
  if p_q is null then
    return null;
  end if;
  select coalesce(array_agg(t.term), '{}'::text[])
    into v_terms
    from (
      select m[1] as term
      from regexp_matches(lower(public.f_unaccent(left(btrim(p_q), 100))), '([[:alnum:]]+)', 'g') as m
      limit 8
    ) t;
  if coalesce(array_length(v_terms, 1), 0) = 0
     or (select sum(char_length(x)) from unnest(v_terms) x) < 2 then
    return null;
  end if;
  v_q := to_tsquery('simple'::regconfig,
    (select string_agg(format('%L', x) || ':*', ' & ') from unnest(v_terms) x));
  if numnode(v_q) = 0 then
    return null;
  end if;
  return v_q;
end;
$$;

create function public.search_messages(p_q text, p_limit int default 20, p_channel uuid default null)
returns table (
  id uuid, channel_id uuid, thread_root_id uuid, author_id uuid,
  created_at timestamptz, snippet text, rank real
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q tsquery := public._search_tsquery(p_q);
  v_limit int := greatest(1, least(50, coalesce(p_limit, 20)));
begin
  if v_q is null then
    return;
  end if;
  return query
    select m.id, m.channel_id, m.thread_root_id, m.author_id, m.created_at,
           left(m.body_text, 160), ts_rank(m.search_tsv, v_q)
    from public.messages m
    where m.search_tsv @@ v_q
      and m.deleted_at is null
      and m.body_text <> ''
      and (p_channel is null or m.channel_id = p_channel)
    order by ts_rank(m.search_tsv, v_q) desc, m.created_at desc
    limit v_limit;
end;
$$;

create function public.search_members(p_q text, p_limit int default 10)
returns table (id uuid, display_name text, wallet_address text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_raw text := lower(btrim(left(coalesce(p_q, ''), 100)));
  v_name text;
  v_hex text;
  v_limit int := greatest(1, least(10, coalesce(p_limit, 10)));
begin
  if char_length(v_raw) < 2 then
    return;
  end if;
  v_name := '%' || replace(replace(replace(public.f_unaccent(v_raw), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_hex := case when v_raw ~ '^(0x)?[0-9a-f]{4,}$' then '0x' || regexp_replace(v_raw, '^0x', '') || '%' end;
  return query
    select m.id, m.display_name, m.wallet_address
    from public.members m
    where m.status = 'active'
      and (lower(public.f_unaccent(coalesce(m.display_name, ''))) like v_name escape '\'
           or (v_hex is not null and m.wallet_address like v_hex))
    order by m.display_name nulls last, m.wallet_address
    limit v_limit;
end;
$$;

revoke execute on function public.f_unaccent(text) from public, anon;
revoke execute on function public._search_tsquery(text) from public, anon;
revoke execute on function public.search_messages(text, int, uuid) from public, anon;
revoke execute on function public.search_members(text, int) from public, anon;
grant execute on function public.f_unaccent(text) to authenticated;
grant execute on function public._search_tsquery(text) to authenticated;
grant execute on function public.search_messages(text, int, uuid) to authenticated;
grant execute on function public.search_members(text, int) to authenticated;
