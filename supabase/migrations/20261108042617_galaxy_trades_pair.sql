-- Galaxy Survivor M5c-2 review: one open trade per pair of accounts, whoever proposed it (a stranger cannot fill
-- someone's open slots by proposing over and over). Proposing ends the pair's expired-but-open row first.
-- Pairs that already have more than one open trade keep the newest; the others are cancelled.
update galaxy.trades t
set status = 'cancelled', closed_at = now()
where t.status = 'open'
  and exists (
    select 1 from galaxy.trades o
    where o.status = 'open'
      and least(o.a_id, o.b_id) = least(t.a_id, t.b_id)
      and greatest(o.a_id, o.b_id) = greatest(t.a_id, t.b_id)
      and (o.created_at, o.id) > (t.created_at, t.id)
  );

create unique index trades_pair_open on galaxy.trades (least(a_id, b_id), greatest(a_id, b_id)) where status = 'open';
