-- Galaxy Survivor M6d-2 (GDD §16.6): the live statistics read the last day, week or month of the append-only ledger and
-- pulls, of the runs, the sales and the trades, every 30 seconds per admin. BRIN on the append-only tables (tiny, rows
-- arrive in time order), btree on the others.

create index ledger_created_brin on galaxy.ledger using brin (created_at);
create index gacha_pulls_created_brin on galaxy.gacha_pulls using brin (created_at);
create index runs_started_at on galaxy.runs (started_at);
create index market_listings_sold_at on galaxy.market_listings (sold_at) where status = 'sold';
create index trades_closed_at on galaxy.trades (closed_at) where closed_at is not null;
