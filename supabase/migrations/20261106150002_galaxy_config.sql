-- Galaxy Survivor M1 (GDD §16.3): live configuration. Every game parameter lives here as versioned JSON per key,
-- validated by the shared Zod schemas (games/galaxy/packages/shared/src/config/registry.ts) on read and on publish.
--
--   game_config_versions   append-only: (key, version) rows; publishing inserts version + 1 (the server serializes
--                          publishes per key with an advisory lock) together with its admin_audit_log row.
--   game_config_active     the newest version of each key (security_invoker: read with galaxy_api's own rights).
--
-- v1 of `features` and `auth` is seeded with exactly the schema defaults.

create table galaxy.game_config_versions (
  id bigserial primary key,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  version int not null check (version >= 1),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid references galaxy.accounts (id) on delete set null,
  note text not null,
  unique (key, version)
);

create function galaxy.forbid_config_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'config_is_append_only';
end;
$$;
revoke all on function galaxy.forbid_config_mutation() from public, anon, authenticated, service_role;
create trigger game_config_versions_append_only
  before update or delete on galaxy.game_config_versions
  for each row execute function galaxy.forbid_config_mutation();
create trigger game_config_versions_no_truncate
  before truncate on galaxy.game_config_versions
  for each statement execute function galaxy.forbid_config_mutation();

create view galaxy.game_config_active
with (security_invoker = true)
as
select distinct on (key) key, version, data, created_at, created_by, note
from galaxy.game_config_versions
order by key, version desc;

alter table galaxy.game_config_versions enable row level security;
create policy galaxy_api_all on galaxy.game_config_versions for all to galaxy_api using (true) with check (true);

revoke all on galaxy.game_config_versions, galaxy.game_config_active from public, anon, authenticated, service_role;
revoke all on sequence galaxy.game_config_versions_id_seq from public, anon, authenticated, service_role;
grant select, insert on galaxy.game_config_versions to galaxy_api;
grant select on galaxy.game_config_active to galaxy_api;
grant usage on sequence galaxy.game_config_versions_id_seq to galaxy_api;

insert into galaxy.game_config_versions (key, version, data, note) values
  ('features', 1, '{"registrationOpen": true, "maintenance": false}', 'versión inicial'),
  ('auth', 1, '{"sessionDays": 30, "adminSessionHours": 12, "registerPerIpHour": 5, "loginPerIpTenMin": 30, "loginPerUserTenMin": 10, "totpPerAccountTenMin": 10, "resetRedeemPerIpHour": 10}', 'versión inicial');
