-- Galaxy Survivor, open beta launch: the config keys may be camelCase. The check from 20261106150002 only allowed
-- lowercase, so `seasonRoute` (the season's route, shop and closing rewards) could never be published and stayed on
-- its code defaults. Still a letter first and at most 41 characters.
alter table galaxy.game_config_versions drop constraint if exists game_config_versions_key_check;
alter table galaxy.game_config_versions add constraint game_config_versions_key_check check (key ~ '^[a-z][a-zA-Z0-9_]{1,40}$');
