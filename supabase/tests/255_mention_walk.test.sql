begin;
select plan(8);

-- F2b re-review: the SQL mention walk must not descend into nodes the sanitizer drops (non-string `type`), and a body
-- that fits the 64 KB cap must not hide a mention from the renderer (sanitizer node budget). The full case list is
-- the shared fixture tests/fixtures/mention-parity.json (TS unit + tests/integration/mention-parity.test.ts).

select set_config('t.a', tests.create_member('0x' || lpad('d2550', 40, '0'), null, true)::text, true);
select set_config('t.u', tests.create_member('0x' || lpad('d2551', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.uu', (select auth_user_id::text from public.members where id = current_setting('t.u')::uuid), true);
select set_config('t.cat', tests.create_channel(null, 'category', 'T255cat')::text, true);
select set_config('t.c', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't255')::text, true);

create function tests.mcount(p_ch uuid, p_body jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := public.post_message(p_ch, p_body, '', false, null, null, '[]'::jsonb);
begin
  return (select count(*)::int from public.message_mentions where message_id = v_id);
end $$;
-- {"type":"doc","content":[hola paragraph, {"type":<p_type>,"content":[member mention]}]}
create function tests.typed(p_type jsonb, p_member uuid) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    '{"type":"paragraph","content":[{"type":"text","text":"hola"}]}'::jsonb,
    jsonb_build_object('type', p_type, 'content', jsonb_build_array(
      jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('kind', 'member', 'id', p_member))))))
$$;
-- a bullet list of p_pairs (hardBreak, listItem) pairs followed by a paragraph with @everyone
create function tests.list_pairs(p_pairs int) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'bulletList', 'content',
      (select jsonb_agg(x order by i, k) from generate_series(1, p_pairs) i,
         lateral (values (1, '{"type":"hardBreak"}'::jsonb), (2, '{"type":"listItem"}'::jsonb)) v(k, x))),
    '{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"everyone"}}]}'::jsonb))
$$;
grant execute on all functions in schema tests to public;

select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(tests.mcount(current_setting('t.c')::uuid, tests.typed('1', current_setting('t.a')::uuid)), 0,
  'no mention under a node whose type is a number');
select is(tests.mcount(current_setting('t.c')::uuid, tests.typed('true', current_setting('t.a')::uuid)), 0,
  'no mention under a node whose type is a boolean');
select is(tests.mcount(current_setting('t.c')::uuid, tests.typed('{"x":1}', current_setting('t.a')::uuid)), 0,
  'no mention under a node whose type is an object');
select is(tests.mcount(current_setting('t.c')::uuid, tests.typed('[]', current_setting('t.a')::uuid)), 0,
  'no mention under a node whose type is an array');
select is(tests.mcount(current_setting('t.c')::uuid, tests.typed('"unknownWrapper"', current_setting('t.a')::uuid)), 1,
  'control: a string-typed unknown wrapper is walked (the sanitizer keeps its children)');
select cmp_ok(octet_length(tests.list_pairs(1300)::text), '<=', 65536, 'the 1300-pair body fits the 64 KB cap');
select is(tests.mcount(current_setting('t.c')::uuid, tests.list_pairs(1300)), 1,
  'the trailing @everyone after 1300 pairs is stored (and rendered: MAX_DOC_NODES is out of reach)');
select tests.clear_authentication();

select ok(not has_function_privilege('authenticated', 'public._insert_mentions(uuid,jsonb,bigint)', 'execute'),
  'authenticated cannot execute _insert_mentions');

select * from finish();
rollback;
