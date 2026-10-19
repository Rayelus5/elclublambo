-- F5 polish: prune_rate_limits() (20261019700102) deletes by window_start alone, and the primary key
-- (subject, bucket, window_start) cannot serve that predicate: it scanned the whole table every hour.
create index rate_limit_hits_window_start_idx on private.rate_limit_hits (window_start);
