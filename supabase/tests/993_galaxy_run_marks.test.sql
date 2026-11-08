-- Galaxy Survivor M6d-3 (migration *_galaxy_run_marks): an admin marks or unmarks a finished run (GDD §16.2). Only
-- `suspicious` and `flags` may change once a run is finished; every other column stays as it was kept.
begin;
select plan(7);

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000009d1', 'pgtap_marks', 'x');
insert into galaxy.runs (id, account_id, seed, sector, probe, relics, content_version, sim_version, start_key)
values ('00000000-0000-4000-8000-0000000009d2', '00000000-0000-4000-8000-0000000009d1', 1, 'outer-nebula', 'lumen', '[]', 0, '1.0.0', 'k-marks-01'),
       ('00000000-0000-4000-8000-0000000009d3', '00000000-0000-4000-8000-0000000009d1', 2, 'outer-nebula', 'lumen', '[]', 0, '1.0.0', 'k-marks-02');
update galaxy.runs set finished_at = now(), outcome = 'died', ticks = 600, depth = 1, kills = 10, boss_kills = 0, level = 2,
  seconds = 10, hash = 'abcdef0123456789', payout = '{}'
where id = '00000000-0000-4000-8000-0000000009d2';

select lives_ok($$update galaxy.runs set suspicious = true, flags = array['admin'] where id = '00000000-0000-4000-8000-0000000009d2'$$,
  'a finished run can be marked');
select lives_ok($$update galaxy.runs set suspicious = false, flags = '{}' where id = '00000000-0000-4000-8000-0000000009d2'$$,
  'and unmarked');
select throws_ok($$update galaxy.runs set suspicious = true, kills = 99999 where id = '00000000-0000-4000-8000-0000000009d2'$$,
  'P0001', 'run_finished', 'a mark never carries another change');
select throws_ok($$update galaxy.runs set hash = '0000000000000000' where id = '00000000-0000-4000-8000-0000000009d2'$$,
  'P0001', 'run_finished', 'the rest of a finished run cannot be rewritten');
select lives_ok($$update galaxy.runs set ticks = 5, kills = 1 where id = '00000000-0000-4000-8000-0000000009d3'$$,
  'a run not finished yet still updates');
-- What the client sent, kept at the finish next to what the server clipped (M6d-3 review), and fixed after it.
select has_column('galaxy', 'runs', 'claim', 'runs keep the claim as sent');
select throws_ok($$update galaxy.runs set claim = '{"ticks": 1}' where id = '00000000-0000-4000-8000-0000000009d2'$$,
  'P0001', 'run_finished', 'the claim of a finished run cannot be rewritten');

select * from finish();
rollback;
