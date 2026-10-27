-- P1 Task 2 (migration 20261024200002): alphas on Base and Arbitrum, each with its own network.
--   - post_message_as takes p_alpha_chain: an enabled chain is stored, a disabled one (Linea) or an unknown one raises
--     chain_invalid.
--   - alpha_details.chain_id has no Linea check and no default; a foreign key to chains takes their place.
--   - Legacy rows with 59144 stay valid and readable (the chains row still exists, disabled).
begin;
select plan(12);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;

-- ===== fixtures: author A with EMBED_LINKS, and an alpha channel =====
select set_config('t.s', tests.create_member('0x' || lpad('d9b10', 40, '0'), null, true)::text, true);
select set_config('t.a', tests.create_member('0x' || lpad('d9b11', 40, '0'), current_setting('t.s')::uuid)::text, true);
insert into public.roles (name, color, position, permissions) values ('T102 embed', '#CCCCCC', 63, 2048);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'T102 embed';
select set_config('t.cat', tests.create_channel(null, 'category', 'Tp102cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'tp102')::text, true);
update public.channels set alpha_enabled = true where id = current_setting('t.ch')::uuid;
select set_config('t.addr', '0x176211869ca2b568f2a7d4ee941e073a821ee1ff', true);

-- ===== schema =====
select is((select count(*)::int from pg_constraint c
           where c.conrelid = 'public.alpha_details'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%59144%'),
  0, 'alpha_details has no Linea check');
select is((select count(*)::int from pg_constraint c
           where c.conrelid = 'public.alpha_details'::regclass and c.contype = 'f'
             and c.confrelid = 'public.chains'::regclass),
  1, 'alpha_details.chain_id references chains');
select is((select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'alpha_details' and column_name = 'chain_id'),
  null, 'alpha_details.chain_id has no default');

-- ===== post_message_as with a chain =====
set local role service_role;
select set_config('t.msg_base', public.post_message_as(current_setting('t.a')::uuid, current_setting('t.ch')::uuid,
  tests.td('tesis en base'), 'tesis en base', false, null, null, '[]', current_setting('t.addr'), 84532)::text, true);
select set_config('t.msg_arb', public.post_message_as(current_setting('t.a')::uuid, current_setting('t.ch')::uuid,
  tests.td('tesis en arbitrum'), 'tesis en arbitrum', false, null, null, '[]', current_setting('t.addr'), 42161)::text, true);
select throws_ok(format($q$select public.post_message_as(%L::uuid, %L::uuid, tests.td('x'), 'x', false, null, null, '[]', %L, 59144)$q$,
  current_setting('t.a'), current_setting('t.ch'), current_setting('t.addr')), 'P0001', 'chain_invalid',
  'Linea (disabled) is chain_invalid');
select throws_ok(format($q$select public.post_message_as(%L::uuid, %L::uuid, tests.td('x'), 'x', false, null, null, '[]', %L, 999)$q$,
  current_setting('t.a'), current_setting('t.ch'), current_setting('t.addr')), 'P0001', 'chain_invalid',
  'an unknown chain is chain_invalid');
select throws_ok(format($q$select public.post_message_as(%L::uuid, %L::uuid, tests.td('x'), 'x', false, null, null, '[]', %L, null)$q$,
  current_setting('t.a'), current_setting('t.ch'), current_setting('t.addr')), 'P0001', 'chain_invalid',
  'a missing chain is chain_invalid');
reset role;

select is((select chain_id from public.alpha_details where message_id = current_setting('t.msg_base')::uuid),
  84532, 'the alpha keeps Base Sepolia');
select is((select chain_id from public.alpha_details where message_id = current_setting('t.msg_arb')::uuid),
  42161, 'the alpha keeps Arbitrum');
select is((select count(*)::int from public.alpha_details where contract_address = current_setting('t.addr')),
  2, 'the rejected alphas wrote no row');

-- ===== legacy rows =====
-- pgTAP cannot insert "before the migration": a row with the old chain (59144) goes in directly. The FK accepts it
-- because the Linea row stays in chains, and it reads back like any other.
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links, kind) values
  ('00000000-0000-0000-0000-0000000000b1', current_setting('t.ch')::uuid, current_setting('t.a')::uuid,
   tests.td('alpha antigua'), 'alpha antigua', true, 'alpha');
select lives_ok($$insert into public.alpha_details (message_id, contract_address, chain_id)
  values ('00000000-0000-0000-0000-0000000000b1', '0x176211869ca2b568f2a7d4ee941e073a821ee1ff', 59144)$$,
  'a legacy alpha with 59144 is still valid');
select is((select chain_id from public.alpha_details where message_id = '00000000-0000-0000-0000-0000000000b1'),
  59144, 'the legacy alpha reads back with 59144');
-- a fresh message without an alpha_details row, so the primary key cannot fire before the foreign key
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links, kind) values
  ('00000000-0000-0000-0000-0000000000b2', current_setting('t.ch')::uuid, current_setting('t.a')::uuid,
   tests.td('alpha sin red'), 'alpha sin red', true, 'alpha');
select throws_ok($$insert into public.alpha_details (message_id, contract_address, chain_id)
  values ('00000000-0000-0000-0000-0000000000b2', '0x176211869ca2b568f2a7d4ee941e073a821ee1ff', 999)$$,
  '23503', null, 'a chain that is not in chains is rejected');

select * from finish();
rollback;
