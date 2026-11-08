-- Galaxy Survivor M6d-2 review (migration *_galaxy_stats_indexes): the live statistics read the recent rows of the
-- append-only ledger, the pulls, the runs, the sales and the trades every 30 seconds; these indexes let them.
begin;
select plan(5);

select has_index('galaxy', 'ledger', 'ledger_created_brin', 'the ledger by time');
select has_index('galaxy', 'gacha_pulls', 'gacha_pulls_created_brin', 'the pulls by time');
select has_index('galaxy', 'runs', 'runs_started_at', 'the runs by start');
select has_index('galaxy', 'market_listings', 'market_listings_sold_at', 'the sales by time');
select has_index('galaxy', 'trades', 'trades_closed_at', 'the trades by close');

select * from finish();
rollback;
