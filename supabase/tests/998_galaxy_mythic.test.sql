-- Galaxy Survivor, plan «rareza Mítica» M1 (migration *_galaxy_mythic): galaxies and pulls accept the sixth tier and
-- nothing above it; a mythic's market floor is its own, the legendary's in a config without it, or 15000 by default.
begin;
select plan(8);

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000009f5', 'pgtap_mythic', 'x');
select lives_ok($$insert into galaxy.galaxies (id, owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin) values
  ('00000000-0000-4000-8000-00000000b005', '00000000-0000-4000-8000-0000000009f5', 7, '1.0.0', '{}', repeat('c', 64), 'Mítica', 'GX-BBBBB5', 5, 30, 'holo', 'grant')$$,
  'a galaxy can be a mythic (tier 5)');
select throws_ok($$insert into galaxy.galaxies (owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin) values
  ('00000000-0000-4000-8000-0000000009f5', 8, '1.0.0', '{}', repeat('d', 64), 'Nada', 'GX-BBBBB6', 6, 30, 'holo', 'grant')$$,
  '23514', null, 'nothing above the mythic');
select lives_ok($$insert into galaxy.gacha_pulls (account_id, banner, pity_group, seed, tier, featured, finish, pity_before, config_version, engine_version, galaxy_id, operation_key)
  values ('00000000-0000-4000-8000-0000000009f5', 'deep-scan', 'standard', 7, 5, false, 'holo', 3, 1, '1.0.0', '00000000-0000-4000-8000-00000000b005', 'pgtap-mythic-pull-1')$$,
  'a pull can give a mythic');
select throws_ok($$insert into galaxy.gacha_pulls (account_id, banner, pity_group, seed, tier, featured, finish, pity_before, config_version, engine_version, galaxy_id, operation_key)
  values ('00000000-0000-4000-8000-0000000009f5', 'deep-scan', 'standard', 8, 6, false, 'holo', 3, 1, '1.0.0', '00000000-0000-4000-8000-00000000b005', 'pgtap-mythic-pull-2')$$,
  '23514', null, 'no pull above the mythic');

-- The floor with a published market config that has no mythic price: the legendary's.
insert into galaxy.game_config_versions (key, version, data, note)
select 'market', coalesce(max(version), 0) + 1, '{"minPrice": {"common": 50, "uncommon": 120, "rare": 400, "epic": 1500, "legendary": 7000}}', 'pgTAP'
from galaxy.game_config_versions where key = 'market';
select throws_ok($$insert into galaxy.market_listings (galaxy_id, seller_id, price, expires_at)
                   values ('00000000-0000-4000-8000-00000000b005', '00000000-0000-4000-8000-0000000009f5', 6999, now() + interval '7 days')$$,
  '23514', null, 'without its own price a mythic is never under the legendary floor');
select lives_ok($$insert into galaxy.market_listings (galaxy_id, seller_id, price, expires_at)
                  values ('00000000-0000-4000-8000-00000000b005', '00000000-0000-4000-8000-0000000009f5', 7000, now() + interval '7 days')$$,
  'at the legendary floor it is listed');

-- With its own price, that one.
insert into galaxy.game_config_versions (key, version, data, note)
select 'market', coalesce(max(version), 0) + 1, '{"minPrice": {"common": 50, "uncommon": 120, "rare": 400, "epic": 1500, "legendary": 7000, "mythic": 20000}}', 'pgTAP'
from galaxy.game_config_versions where key = 'market';
select throws_ok($$update galaxy.market_listings set price = 19999 where galaxy_id = '00000000-0000-4000-8000-00000000b005'$$,
  '23514', null, 'the mythic floor of the live config');
select lives_ok($$update galaxy.market_listings set price = 20000 where galaxy_id = '00000000-0000-4000-8000-00000000b005'$$,
  'at its own floor it is listed');

select * from finish();
rollback;
