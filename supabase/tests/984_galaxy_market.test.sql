-- Galaxy Survivor M5c-1 Task 2 (migration *_galaxy_market): the market's listings (one active per galaxy, a price
-- never under the floor of its rarity) and the alerts for the admin.
begin;
select plan(16);

select has_table('galaxy', 'market_listings', 'market_listings');
select has_table('galaxy', 'trade_alerts', 'trade_alerts');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('market_listings', 'trade_alerts')),
  'row level security on both tables');
select ok(has_table_privilege('galaxy_api', 'galaxy.market_listings', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.market_listings', 'delete')
      and has_table_privilege('galaxy_api', 'galaxy.trade_alerts', 'select, insert')
      and not has_table_privilege('galaxy_api', 'galaxy.trade_alerts', 'update')
      and not has_table_privilege('anon', 'galaxy.market_listings', 'select')
      and not has_table_privilege('authenticated', 'galaxy.trade_alerts', 'select'),
  'galaxy_api lists, sells and warns; nothing is deleted and nobody else reaches the market');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f1', 'pgtap_seller', 'x'),
  ('00000000-0000-4000-8000-0000000000f2', 'pgtap_buyer', 'x');
insert into galaxy.galaxies (id, owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin) values
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000f1', 1, '1.0.0', '{}', repeat('a', 64), 'Común', 'GX-AAAAA1', 0, 1, 'normal', 'pull'),
  ('00000000-0000-4000-8000-00000000a005', '00000000-0000-4000-8000-0000000000f1', 2, '1.0.0', '{}', repeat('b', 64), 'Leyenda', 'GX-AAAAA5', 4, 1, 'normal', 'pull');

select throws_ok($$insert into galaxy.market_listings (galaxy_id, seller_id, price, expires_at)
                   values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000f1', 49, now() + interval '7 days')$$,
  '23514', null, 'a common galaxy is never under 50 coins');
select throws_ok($$insert into galaxy.market_listings (galaxy_id, seller_id, price, expires_at)
                   values ('00000000-0000-4000-8000-00000000a005', '00000000-0000-4000-8000-0000000000f1', 5999, now() + interval '7 days')$$,
  '23514', null, 'a legendary galaxy is never under 6000 coins');
select lives_ok($$insert into galaxy.market_listings (galaxy_id, seller_id, price, expires_at)
                  values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000f1', 50, now() + interval '7 days')$$,
  'at the floor it is listed');
select throws_ok($$insert into galaxy.market_listings (galaxy_id, seller_id, price, expires_at)
                   values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000f1', 80, now() + interval '7 days')$$,
  '23505', null, 'one active listing per galaxy');
select throws_ok($$update galaxy.market_listings set price = 10 where galaxy_id = '00000000-0000-4000-8000-00000000a001'$$,
  '23514', null, 'a price cannot drop under the floor later either');
select throws_ok($$update galaxy.market_listings set status = 'sold' where galaxy_id = '00000000-0000-4000-8000-00000000a001'$$,
  '23514', null, 'a sale has its time and its commission');
select lives_ok($$update galaxy.market_listings set status = 'sold', buyer_id = '00000000-0000-4000-8000-0000000000f2', sold_at = now(), commission = 3
                  where galaxy_id = '00000000-0000-4000-8000-00000000a001'$$,
  'sold with its buyer, time and commission');

-- A published market config raises the floor.
insert into galaxy.game_config_versions (key, version, data, note)
select 'market', coalesce(max(version), 0) + 1, '{"minPrice": {"common": 90, "uncommon": 120, "rare": 400, "epic": 1500, "legendary": 6000}}', 'pgTAP'
from galaxy.game_config_versions where key = 'market';
select throws_ok($$insert into galaxy.market_listings (galaxy_id, seller_id, price, expires_at)
                   values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000f1', 80, now() + interval '7 days')$$,
  '23514', null, 'the live config sets the floor');
select lives_ok($$insert into galaxy.market_listings (galaxy_id, seller_id, price, expires_at)
                  values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000f1', 90, now() + interval '7 days')$$,
  'once sold, the galaxy can be listed again (at the new floor)');
select throws_ok($$insert into galaxy.trade_alerts (kind) values ('gossip')$$, '23514', null, 'an alert is a shared IP or an unbalanced price');

select has_table('galaxy', 'account_ips', 'the IPs an account signed in from');
select ok(has_table_privilege('galaxy_api', 'galaxy.account_ips', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.account_ips', 'delete')
      and not has_table_privilege('anon', 'galaxy.account_ips', 'select'),
  'galaxy_api keeps the IPs and never deletes them; nobody else reads them');

select * from finish();
rollback;
