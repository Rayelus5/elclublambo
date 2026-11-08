-- Galaxy Survivor M6c-2 (GDD §16.4): moderating trade. An admin may revert a sale or a done trade once: the reversal
-- is a row of its own (the listing stays 'sold', the trade 'done', history is never rewritten), next to the galaxies
-- moved back and the compensating ledger entries. A suspicious-trade alert is reviewed with a reason; its reviewer may
-- later be deleted (set null), the time and the reason stay.

create table galaxy.deal_reversals (
  id bigint generated always as identity primary key,
  listing_id uuid unique references galaxy.market_listings (id) on delete cascade,
  trade_id uuid unique references galaxy.trades (id) on delete cascade,
  by_id uuid references galaxy.accounts (id) on delete set null,
  reason text not null check (length(reason) between 3 and 300),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  check (num_nonnulls(listing_id, trade_id) = 1)
);

alter table galaxy.trade_alerts
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references galaxy.accounts (id) on delete set null,
  add column review_reason text check (length(review_reason) between 3 and 300),
  add constraint trade_alerts_review check ((reviewed_at is null) = (review_reason is null));
create index trade_alerts_pending on galaxy.trade_alerts (created_at desc) where reviewed_at is null;

alter table galaxy.deal_reversals enable row level security;
create policy galaxy_api_all on galaxy.deal_reversals for all to galaxy_api using (true) with check (true);
revoke all on galaxy.deal_reversals from public, anon, authenticated, service_role;
revoke all on sequence galaxy.deal_reversals_id_seq from public, anon, authenticated, service_role;
grant select, insert on galaxy.deal_reversals to galaxy_api;
grant usage on sequence galaxy.deal_reversals_id_seq to galaxy_api;
grant update (reviewed_at, reviewed_by, review_reason) on galaxy.trade_alerts to galaxy_api;
