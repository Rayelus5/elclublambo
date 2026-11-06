-- Galaxy Survivor M1 Task 6 (migration 20261106150002_galaxy_config): live configuration, append-only and versioned
-- per key; game_config_active exposes the latest version of each key; v1 of `features` and `auth` is seeded.
begin;
select plan(12);

select has_table('galaxy', 'game_config_versions', 'game_config_versions');
select has_view('galaxy', 'game_config_active', 'game_config_active');

select ok(has_table_privilege('galaxy_api', 'galaxy.game_config_versions', 'select')
      and has_table_privilege('galaxy_api', 'galaxy.game_config_versions', 'insert')
      and not has_table_privilege('galaxy_api', 'galaxy.game_config_versions', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.game_config_versions', 'delete'),
  'galaxy_api: config select/insert only');
select ok(has_table_privilege('galaxy_api', 'galaxy.game_config_active', 'select')
      and not has_table_privilege('anon', 'galaxy.game_config_versions', 'select')
      and not has_table_privilege('authenticated', 'galaxy.game_config_active', 'select'),
  'only galaxy_api reads the configuration');

select is((select data from galaxy.game_config_active where key = 'features'),
  '{"registrationOpen": true, "maintenance": false}'::jsonb, 'features v1 seeded with the schema defaults');
select is((select data from galaxy.game_config_active where key = 'auth'),
  '{"sessionDays": 30, "adminSessionHours": 12, "registerPerIpHour": 5, "loginPerIpTenMin": 30, "loginPerUserTenMin": 10, "totpPerAccountTenMin": 10, "resetRedeemPerIpHour": 10}'::jsonb,
  'auth v1 seeded with the schema defaults');

insert into galaxy.game_config_versions (key, version, data, note)
select 'features', max(version) + 1, '{"registrationOpen": false, "maintenance": false}', 'pgTAP'
from galaxy.game_config_versions where key = 'features';
select is((select data ->> 'registrationOpen' from galaxy.game_config_active where key = 'features'), 'false',
  'the view follows the newest version');

select throws_ok($$update galaxy.game_config_versions set note = 'x'$$, 'P0001', 'config_is_append_only',
  'versions cannot be updated');
select throws_ok($$delete from galaxy.game_config_versions$$, 'P0001', 'config_is_append_only', 'versions cannot be deleted');
select throws_ok($$insert into galaxy.game_config_versions (key, version, data, note) values ('features', 1, '{}', 'dup')$$,
  '23505', null, 'one row per (key, version)');
select throws_ok($$insert into galaxy.game_config_versions (key, version, data, note) values ('nueva', 0, '{}', 'cero')$$,
  '23514', null, 'versions start at 1');
select throws_ok($$insert into galaxy.game_config_versions (key, version, data, note) values ('nueva', 1, '[1]', 'array')$$,
  '23514', null, 'data must be a JSON object');

select * from finish();
rollback;
