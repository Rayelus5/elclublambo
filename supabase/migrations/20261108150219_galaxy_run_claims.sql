-- Galaxy Survivor M6d-3 review (GDD §14.7, §16.2): a run keeps the figures its client sent at the finish (ticks, depth,
-- kills, boss kills, level), next to the ones the server kept after clipping them to real time. The replayer plays a
-- run to the ticks it sent and compares against what it sent: the hash was always kept as sent. Null for runs finished
-- before this migration. Set once, with the finish (runs_finish_once keeps it fixed afterwards).

alter table galaxy.runs add column claim jsonb check (claim is null or jsonb_typeof(claim) = 'object');
