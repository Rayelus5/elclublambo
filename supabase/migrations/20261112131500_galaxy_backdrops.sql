-- Galaxy Survivor, plan «escáner pro» part E (the owner: «el propio jugador pudiera elegir las que él quiera que se
-- muestren» en el fondo del menú de inicio): the galaxies a player chose for the title screen's sky, up to twelve,
-- shown in random order. A galaxy that stops being theirs (sold, traded) is left out when read; one deleted goes with it.

create table galaxy.backdrops (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  slot smallint not null check (slot between 0 and 11),
  galaxy_id uuid not null references galaxy.galaxies (id) on delete cascade,
  primary key (account_id, slot),
  unique (account_id, galaxy_id)
);

alter table galaxy.backdrops enable row level security;
create policy galaxy_api_all on galaxy.backdrops for all to galaxy_api using (true) with check (true);
revoke all on galaxy.backdrops from public, anon, authenticated, service_role;
grant select, insert, delete on galaxy.backdrops to galaxy_api;
