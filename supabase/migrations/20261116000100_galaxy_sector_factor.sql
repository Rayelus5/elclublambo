-- Pay by sector (Galaxy, 2026-11-16): what a run's sector pays, snapshotted at its start from the live `sectors.pay`
-- config, so the result, the season points and the ranking all use the same factor. Runs started before this pay ×1.
-- Double precision (not real): the ranking multiplies it in SQL and the server in JavaScript, and both must agree.
alter table galaxy.runs
  add column sector_factor double precision not null default 1 check (sector_factor > 0 and sector_factor <= 5);

comment on column galaxy.runs.sector_factor is 'What the run''s sector pays (sectors.pay at its start): coins, dust, material, components and season points; experience never below 1.';
