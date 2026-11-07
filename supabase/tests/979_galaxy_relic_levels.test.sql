-- Galaxy Survivor M4c-1 Task 2 (migration *_galaxy_relic_levels): the dust put into each galaxy's levels, returned in
-- part when it is fused or disintegrated.
begin;
select plan(4);

select has_column('galaxy', 'galaxies', 'level_dust', 'galaxies keep the dust put into their levels');
select col_default_is('galaxy', 'galaxies', 'level_dust', '0', 'none by default');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f5', 'pgtap_relics', 'x');

select throws_ok($$insert into galaxy.galaxies (owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin, level_dust)
                   values ('00000000-0000-4000-8000-0000000000f5', '1', '1.0.0', '{}', 'ab', 'Prueba', 'GX-000001', 0, 0, 'normal', 'grant', -1)$$,
  '23514', null, 'the dust put into levels is never negative');
select throws_ok($$insert into galaxy.galaxies (owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin, level)
                   values ('00000000-0000-4000-8000-0000000000f5', '2', '1.0.0', '{}', 'ab', 'Prueba', 'GX-000002', 0, 0, 'normal', 'grant', 11)$$,
  '23514', null, 'a level is still at most 10');

select * from finish();
rollback;
