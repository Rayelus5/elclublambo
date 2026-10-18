-- F4b Task 1: last-good copy of the CoinGecko payloads (market list, coin detail, charts).
-- Display-only data. Service role only: RLS on, no policies, no grants for anon/authenticated.
create table public.market_cache (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null
);

alter table public.market_cache enable row level security;

revoke all on table public.market_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.market_cache to service_role;
