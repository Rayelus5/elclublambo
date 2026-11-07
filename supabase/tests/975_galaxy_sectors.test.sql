-- Galaxy Survivor M3b-3 Task 7 (migration *_galaxy_sectors): the hangar keeps the chosen sector.
begin;
select plan(4);

select has_column('galaxy', 'hangars', 'sector', 'hangars.sector');
select ok(has_column_privilege('galaxy_api', 'galaxy.hangars', 'sector', 'update'), 'galaxy_api can choose the sector');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f1', 'pgtap_sectors', 'x');
insert into galaxy.hangars (account_id) values ('00000000-0000-4000-8000-0000000000f1');

select is((select sector from galaxy.hangars where account_id = '00000000-0000-4000-8000-0000000000f1'),
  'outer-nebula', 'a new hangar starts in the Outer Nebula');
select throws_ok($$update galaxy.hangars set sector = 'Mal Id' where account_id = '00000000-0000-4000-8000-0000000000f1'$$,
  '23514', null, 'a sector id is lowercase letters, digits and dashes');

select * from finish();
rollback;
