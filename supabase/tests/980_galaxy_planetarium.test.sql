-- Galaxy Survivor M4c-2 Task 2 (migration *_galaxy_planetarium): the galaxies each account exhibits in its planetarium,
-- one per pedestal, and the visits it receives, one per visitor and UTC day.
begin;
select plan(14);

select has_table('galaxy', 'exhibits', 'exhibits');
select has_table('galaxy', 'planetarium_visits', 'planetarium_visits');
select col_is_pk('galaxy', 'exhibits', array['account_id', 'slot'], 'one galaxy per account and pedestal');
select col_is_pk('galaxy', 'planetarium_visits', array['owner_id', 'visitor_id', 'day'], 'one visit per visitor, owner and day');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('exhibits', 'planetarium_visits')),
  'row level security on both tables');
select ok(has_table_privilege('galaxy_api', 'galaxy.exhibits', 'select, insert, update, delete')
      and has_table_privilege('galaxy_api', 'galaxy.planetarium_visits', 'select, insert')
      and not has_table_privilege('galaxy_api', 'galaxy.planetarium_visits', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.planetarium_visits', 'delete'),
  'galaxy_api swaps exhibits, and only adds visits');
select ok(not has_table_privilege('anon', 'galaxy.exhibits', 'select')
      and not has_table_privilege('authenticated', 'galaxy.exhibits', 'select')
      and not has_table_privilege('anon', 'galaxy.planetarium_visits', 'select')
      and not has_table_privilege('authenticated', 'galaxy.planetarium_visits', 'select')
      and not has_table_privilege('service_role', 'galaxy.planetarium_visits', 'select'),
  'only galaxy_api reaches the planetarium');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f5', 'pgtap_planet', 'x'),
  ('00000000-0000-4000-8000-0000000000f6', 'pgtap_visitor', 'x');
insert into galaxy.galaxies (id, owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin)
values ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000f5', 1, '1.0.0', '{}',
        repeat('a', 64), 'Pgtap', 'GX-AAAAAA', 2, 10, 'holo', 'pull');

select lives_ok($$insert into galaxy.exhibits (account_id, slot, galaxy_id)
                  values ('00000000-0000-4000-8000-0000000000f5', 1, '00000000-0000-4000-8000-0000000000a5')$$,
  'a galaxy on pedestal 1');
select throws_ok($$insert into galaxy.exhibits (account_id, slot, galaxy_id)
                   values ('00000000-0000-4000-8000-0000000000f5', 2, '00000000-0000-4000-8000-0000000000a5')$$,
  '23505', null, 'a galaxy stands on one pedestal at most');
select throws_ok($$insert into galaxy.exhibits (account_id, slot, galaxy_id)
                   values ('00000000-0000-4000-8000-0000000000f5', 9, gen_random_uuid())$$,
  '23514', null, 'there are eight pedestals at most');
select throws_ok($$delete from galaxy.galaxies where id = '00000000-0000-4000-8000-0000000000a5'$$,
  '23503', null, 'an exhibited galaxy cannot be deleted');

select lives_ok($$insert into galaxy.planetarium_visits (owner_id, visitor_id)
                  values ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000f6')$$,
  'a visit, dated today (UTC)');
select throws_ok($$insert into galaxy.planetarium_visits (owner_id, visitor_id, day)
                   values ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000f6', (now() at time zone 'utc')::date)$$,
  '23505', null, 'the same visitor counts once a day');
select throws_ok($$insert into galaxy.planetarium_visits (owner_id, visitor_id)
                   values ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000f5')$$,
  '23514', null, 'nobody visits their own planetarium');

select * from finish();
rollback;
