-- Galaxy Survivor M3b-3 (GDD §5.5): the sector chosen in the hangar for the next runs. Which sectors are open is
-- computed from the runs (galaxy.runs) and the live config `sectors`; only the choice is kept here.
alter table galaxy.hangars
  add column sector text not null default 'outer-nebula' check (sector ~ '^[a-z0-9-]{1,32}$');
