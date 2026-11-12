-- Galaxy Survivor, plan «notas de versión» (migration *_galaxy_release_notes): the panel's release notes, reached by the
-- API only, with their id, version and items checked.
begin;
select plan(5);

select has_table('galaxy', 'release_notes', 'release_notes');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'release_notes')
      and has_table_privilege('galaxy_api', 'galaxy.release_notes', 'select, insert, update, delete')
      and not has_table_privilege('anon', 'galaxy.release_notes', 'select')
      and not has_table_privilege('authenticated', 'galaxy.release_notes', 'select'),
  'row level security on; only the API reaches it');
select lives_ok($$insert into galaxy.release_notes (id, version, date, title, items) values ('v9-9-pgtap', '9.9', '2026-12-01', 'Prueba', '[{"kind": "nuevo", "text": "Algo"}]')$$,
  'a note with its items');
select throws_ok($$insert into galaxy.release_notes (id, version, date, title, items) values ('v9-8-pgtap', 'beta', '2026-12-01', 'Prueba', '[]')$$,
  '23514', null, 'a version that is not N.N is refused');
select throws_ok($$insert into galaxy.release_notes (id, version, date, title, items) values ('Con Espacios', '9.7', '2026-12-01', 'Prueba', '[]')$$,
  '23514', null, 'an id that is not a slug is refused');

select * from finish();
rollback;
