-- Galaxy Survivor M8b (migration *_galaxy_retention, GDD §18): the retention function deletes what has expired and
-- nothing else; run_inputs stays append-only outside it.
begin;
select plan(7);

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000009f1', 'pgtap_retention', 'x');
insert into galaxy.runs (id, account_id, seed, sector, probe, relics, content_version, sim_version, start_key, started_at, finished_at, outcome, depth, boss_kills, suspicious)
values
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000009f1', 1, 'outer-nebula', 'lumen', '[]', 1, '1.6.0', 'pgtap-retention-1', now() - interval '40 days', now() - interval '40 days', 'died', 1, 0, false),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000009f1', 2, 'outer-nebula', 'lumen', '[]', 1, '1.6.0', 'pgtap-retention-2', now() - interval '40 days', now() - interval '40 days', 'extracted', 3, 1, false),
  ('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-0000000009f1', 3, 'outer-nebula', 'lumen', '[]', 1, '1.6.0', 'pgtap-retention-3', now() - interval '40 days', now() - interval '40 days', 'died', 1, 0, true),
  ('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-0000000009f1', 4, 'outer-nebula', 'lumen', '[]', 1, '1.6.0', 'pgtap-retention-4', now() - interval '2 days', now() - interval '2 days', 'died', 1, 0, false);
insert into galaxy.run_inputs (run_id, inputs, created_at) values
  ('00000000-0000-4000-8000-00000000a001', '\x00', now() - interval '40 days'),
  ('00000000-0000-4000-8000-00000000a002', '\x00', now() - interval '40 days'),
  ('00000000-0000-4000-8000-00000000a003', '\x00', now() - interval '40 days'),
  ('00000000-0000-4000-8000-00000000a004', '\x00', now() - interval '2 days');
insert into galaxy.chat_messages (channel, author_id, body, created_at) values
  ('global', '00000000-0000-4000-8000-0000000009f1', 'viejo', now() - interval '100 days'),
  ('global', '00000000-0000-4000-8000-0000000009f1', 'viejo y denunciado', now() - interval '100 days'),
  ('global', '00000000-0000-4000-8000-0000000009f1', 'nuevo', now() - interval '10 days');
insert into galaxy.chat_reports (message_id, reporter_id) select id, '00000000-0000-4000-8000-0000000009f1' from galaxy.chat_messages where body = 'viejo y denunciado';

select throws_ok($$delete from galaxy.run_inputs where run_id = '00000000-0000-4000-8000-00000000a001'$$, 'P0001', 'append_only', 'outside the function inputs are append-only');
select ok(has_function_privilege('galaxy_api', 'galaxy.prune_retention()', 'execute') and not has_function_privilege('anon', 'galaxy.prune_retention()', 'execute'), 'only galaxy_api runs it');
select ok((select (galaxy.prune_retention() ->> 'inputs')::int >= 1), 'it deletes expired inputs');
select is((select array_agg(run_id order by run_id)::text[] from galaxy.run_inputs where run_id::text like '00000000-0000-4000-8000-00000000a00%'),
  array['00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000a004'],
  'an ordinary old run goes; a record, a suspicious one and a recent one stay');
select is((select array_agg(body order by body) from galaxy.chat_messages where author_id = '00000000-0000-4000-8000-0000000009f1'),
  array['nuevo', 'viejo y denunciado'], 'old chat goes unless reported');
select is(current_setting('galaxy.retention', true), 'off', 'the guard is closed again after the function');
select throws_ok($$delete from galaxy.run_inputs where run_id = '00000000-0000-4000-8000-00000000a004'$$, 'P0001', 'append_only', 'and still append-only after it');

select * from finish();
rollback;
