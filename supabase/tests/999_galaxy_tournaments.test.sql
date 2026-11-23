-- Galaxy Survivor: tournaments (migration *_galaxy_tournaments; plan «temporadas como fichas», part 5): a fee never goes
-- with a money prize and a tournament lasts 31 days at most (28 until 20261123130000); history stays (only drafts are
-- deleted, with their rows);
-- an entry's sign-up and what was set once stay; a money prize is marked paid once; the retention keeps the inputs of
-- the runs an entrant played for a tournament not yet finished.
begin;
select plan(15);

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000009e1', 'pgtap_tournament', 'x');
insert into galaxy.tournaments (id, slug, season_id, title, starts_at, ends_at, state, metric, prizes)
values
  ('00000000-0000-4000-8000-00000000e001', 'pgtap-torneo', 'season-x', 'Torneo', now() - interval '40 days', now() - interval '35 days', 'running', 'points', '[{"from":1,"to":1,"gifts":[],"cash":{"amountEur":10,"note":""}}]'),
  ('00000000-0000-4000-8000-00000000e002', 'pgtap-borrador', 'season-x', 'Borrador', now(), now() + interval '2 days', 'draft', 'kills', '[]');

select throws_ok($$insert into galaxy.tournaments (slug, season_id, title, starts_at, ends_at, metric, entry, prizes)
  values ('pgtap-pago', 'season-x', 'Pago', now(), now() + interval '1 day', 'points', '{"currency":"coins","amount":5}', '[{"from":1,"to":1,"gifts":[],"cash":{"amountEur":10,"note":""}}]')$$,
  '23514', null, 'a fee never goes with a money prize');
select lives_ok($$insert into galaxy.tournaments (slug, season_id, title, starts_at, ends_at, metric, entry, prizes)
  values ('pgtap-pago-ok', 'season-x', 'Pago', now(), now() + interval '1 day', 'points', '{"currency":"coins","amount":5}', '[{"from":1,"to":1,"gifts":[],"cash":null}]')$$,
  'a fee with prizes in gifts is fine');
select lives_ok($$insert into galaxy.tournaments (slug, season_id, title, starts_at, ends_at, metric)
  values ('pgtap-mes', 'season-x', 'Un mes', now(), now() + interval '31 days', 'points')$$, '31 days exactly is fine (the Christmas tournament)');
select throws_ok($$insert into galaxy.tournaments (slug, season_id, title, starts_at, ends_at, metric)
  values ('pgtap-largo', 'season-x', 'Largo', now(), now() + interval '31 days 1 second', 'points')$$, '23514', null, '31 days at most');

insert into galaxy.tournament_entries (tournament_id, account_id, joined_at, entry_key) values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000009e1', now() - interval '39 days', 'pgtap-entry-1');
select throws_ok($$update galaxy.tournament_entries set joined_at = now() where tournament_id = '00000000-0000-4000-8000-00000000e001'$$, 'P0001', 'tournament_entry_fixed', 'the sign-up never moves');
update galaxy.tournament_entries set left_at = now() - interval '38 days' where tournament_id = '00000000-0000-4000-8000-00000000e001';
select throws_ok($$update galaxy.tournament_entries set left_at = null where tournament_id = '00000000-0000-4000-8000-00000000e001'$$, 'P0001', 'tournament_entry_fixed', 'who left stays out');
select throws_ok($$delete from galaxy.tournament_entries where tournament_id = '00000000-0000-4000-8000-00000000e001'$$, 'P0001', 'tournament_rows_keep_history', 'an entry is not deleted');
select throws_ok($$delete from galaxy.tournaments where id = '00000000-0000-4000-8000-00000000e001'$$, 'P0001', 'tournaments_keep_history', 'a tournament that was scheduled stays');
select lives_ok($$delete from galaxy.tournaments where id = '00000000-0000-4000-8000-00000000e002'$$, 'a draft is deleted');

insert into galaxy.tournament_cash (tournament_id, account_id, rank, amount_eur) values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000009e1', 1, 10);
update galaxy.tournament_cash set paid_at = now() where tournament_id = '00000000-0000-4000-8000-00000000e001';
select throws_ok($$update galaxy.tournament_cash set paid_at = now() + interval '1 day' where tournament_id = '00000000-0000-4000-8000-00000000e001'$$, 'P0001', 'tournament_cash_fixed', 'paid once');

select throws_ok($$insert into galaxy.mailbox_messages (title, body, gifts, audience, type, link, expires_at) values ('t', 'b', '{}', '{"kind":"all"}', 'tournament', 'https://otra.web', now() + interval '1 day')$$, '23514', null, 'a link is a page of the game');

-- Retention: an old run of a live entrant (a second entry, still in) keeps its inputs while the tournament is not finished.
insert into galaxy.tournaments (id, slug, season_id, title, starts_at, ends_at, state, metric)
values ('00000000-0000-4000-8000-00000000e003', 'pgtap-revision', 'season-x', 'Revisión', now() - interval '45 days', now() - interval '40 days', 'review', 'points');
insert into galaxy.tournament_entries (tournament_id, account_id, joined_at, entry_key) values ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-0000000009e1', now() - interval '45 days', 'pgtap-entry-2');
insert into galaxy.runs (id, account_id, seed, sector, probe, relics, content_version, sim_version, start_key, started_at, finished_at, outcome, depth, boss_kills, suspicious)
values
  ('00000000-0000-4000-8000-00000000e101', '00000000-0000-4000-8000-0000000009e1', 1, 'outer-nebula', 'lumen', '[]', 1, '1.6.0', 'pgtap-tournament-1', now() - interval '42 days', now() - interval '42 days', 'died', 1, 0, false),
  ('00000000-0000-4000-8000-00000000e102', '00000000-0000-4000-8000-0000000009e1', 2, 'outer-nebula', 'lumen', '[]', 1, '1.6.0', 'pgtap-tournament-2', now() - interval '50 days', now() - interval '50 days', 'died', 1, 0, false);
insert into galaxy.run_inputs (run_id, inputs, created_at) values
  ('00000000-0000-4000-8000-00000000e101', '\x00', now() - interval '42 days'),
  ('00000000-0000-4000-8000-00000000e102', '\x00', now() - interval '50 days');
select ok((select galaxy.prune_retention() is not null), 'the retention runs');
select is((select array_agg(run_id::text order by run_id) from galaxy.run_inputs where run_id::text like '00000000-0000-4000-8000-00000000e10%'),
  array['00000000-0000-4000-8000-00000000e101'], 'the run in the tournament keeps its inputs; the one before it does not');
update galaxy.tournaments set state = 'finished' where id = '00000000-0000-4000-8000-00000000e003';
-- Two statements: a query does not see what a function it calls deleted (its snapshot is the statement's).
select ok((select (galaxy.prune_retention() ->> 'inputs')::int >= 1), 'once finished, the retention deletes them');
select ok(not exists (select 1 from galaxy.run_inputs where run_id = '00000000-0000-4000-8000-00000000e101'), 'once finished, they go too');

select * from finish();
rollback;
