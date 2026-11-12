-- Galaxy Survivor, plan «banda sonora, skins, perfil y entorno», part C (migration *_galaxy_probe_skins): a skin is a
-- cosmetic, and each probe keeps the one it wears.
begin;
select plan(4);

select has_column('galaxy', 'probe_levels', 'skin', 'probe_levels.skin');

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000009f3', 'pgtap_skins', 'x');
select lives_ok($$insert into galaxy.cosmetics (account_id, kind, value) values ('00000000-0000-4000-8000-0000000009f3', 'skin', 'skin-lumen-coral')$$, 'a skin is a cosmetic');
select lives_ok($$insert into galaxy.probe_levels (account_id, probe, skin) values ('00000000-0000-4000-8000-0000000009f3', 'lumen', 'skin-lumen-coral')$$, 'a probe wears it');
select throws_ok($$update galaxy.probe_levels set skin = 'Coral!' where account_id = '00000000-0000-4000-8000-0000000009f3'$$, '23514', null, 'only skin ids');

select * from finish();
rollback;
