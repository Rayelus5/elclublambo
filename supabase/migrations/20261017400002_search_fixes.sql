-- F2d search fixes: drop one-letter terms before the 8-term cap, parallel safe tsquery helper,
-- symmetric unaccent/lower order in member search. Same signatures and grants as 20261017400001.

-- Caveat on public.f_unaccent (declared immutable although unaccent() is only stable): if unaccent.rules
-- changes on a Postgres/extension upgrade, stored search_tsv values drift from query-side unaccent.
-- Remediation: `update public.messages set body_text = body_text;` regenerates every vector.
comment on function public.f_unaccent(text) is
  'Immutable wrapper over unaccent for generated columns/indexes. If unaccent.rules changes, run: update public.messages set body_text = body_text;';

create or replace function public._search_tsquery(p_q text)
returns tsquery
language plpgsql
immutable parallel safe
set search_path = ''
as $$
declare
  v_terms text[];
  v_q tsquery;
begin
  if p_q is null then
    return null;
  end if;
  -- one-letter terms are noise: drop them first so they do not use up the 8-term cap
  select coalesce(array_agg(t.term), '{}'::text[])
    into v_terms
    from (
      select m[1] as term
      from regexp_matches(lower(public.f_unaccent(left(btrim(p_q), 100))), '([[:alnum:]]+)', 'g') as m
      where char_length(m[1]) >= 2
      limit 8
    ) t;
  if coalesce(array_length(v_terms, 1), 0) = 0 then
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

create or replace function public.search_members(p_q text, p_limit int default 10)
returns table (id uuid, display_name text, wallet_address text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_raw text := btrim(left(coalesce(p_q, ''), 100));
  v_name text;
  v_hex text;
  v_limit int := greatest(1, least(10, coalesce(p_limit, 10)));
begin
  if char_length(v_raw) < 2 then
    return;
  end if;
  -- same order on both sides: unaccent, then lower
  v_name := '%' || replace(replace(replace(lower(public.f_unaccent(v_raw)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_hex := case when lower(v_raw) ~ '^(0x)?[0-9a-f]{4,}$' then '0x' || regexp_replace(lower(v_raw), '^0x', '') || '%' end;
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
