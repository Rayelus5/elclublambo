-- Galaxy Survivor: a tournament lasts 31 days at most (plan «Torneo Navideño», 2026-11-23; GDD §13.3 [U]). The record
-- already allows it (TOURNAMENT_MAX_DAYS, PR #281), but the table still held the first limit, 28 days, in an unnamed
-- check (`tournaments_check1` where 20261121230409_galaxy_tournaments made it), so saving the Christmas tournament
-- (1 to 31 December) failed on the database. The old check is found by what it says, not by its generated name, and
-- the new one is named, so the next change knows what to drop. Widening a limit: every stored row still fits.

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'galaxy.tournaments'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%ends_at - starts_at%28 days%'
  loop
    execute format('alter table galaxy.tournaments drop constraint %I', c.conname);
  end loop;
end
$$;

alter table galaxy.tournaments
  add constraint tournaments_span_check check (ends_at - starts_at <= interval '31 days');
