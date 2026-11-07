-- Galaxy Survivor M4c-1 (GDD §8.4 bis): the dust put into each galaxy's levels. Fusing or disintegrating a galaxy
-- returns part of it (live config relics.refund); the level itself was already galaxies.level (1–10).

alter table galaxy.galaxies add column level_dust integer not null default 0 check (level_dust >= 0);
