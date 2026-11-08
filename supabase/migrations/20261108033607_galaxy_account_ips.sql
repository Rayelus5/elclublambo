-- Galaxy Survivor M5c-1 review (GDD §14.7): the IPs each account signed in from, kept after its sessions end (a logout
-- deletes the session row). The market's shared-IP alerts read them; filled from the sessions alive today.
create table galaxy.account_ips (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  ip text not null check (length(ip) between 2 and 64),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (account_id, ip)
);
create index account_ips_ip on galaxy.account_ips (ip, last_seen desc);

insert into galaxy.account_ips (account_id, ip, first_seen, last_seen)
select account_id, ip, min(created_at), max(created_at)
from galaxy.sessions
where ip is not null
group by account_id, ip
on conflict do nothing;

alter table galaxy.account_ips enable row level security;
create policy galaxy_api_all on galaxy.account_ips for all to galaxy_api using (true) with check (true);
revoke all on galaxy.account_ips from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.account_ips to galaxy_api;
