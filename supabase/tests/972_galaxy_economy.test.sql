-- Galaxy Survivor M2b Task 4 (migration 20261106201600_galaxy_economy_gacha): wallet (balances + append-only ledger),
-- idempotent operations, owned galaxies and the deep scan's luck state and pull audit.
begin;
select plan(20);

select has_table('galaxy', 'balances', 'balances');
select has_table('galaxy', 'ledger', 'ledger');
select has_table('galaxy', 'operations', 'operations');
select has_table('galaxy', 'galaxies', 'galaxies');
select has_table('galaxy', 'gacha_accounts', 'gacha_accounts');
select has_table('galaxy', 'gacha_state', 'gacha_state');
select has_table('galaxy', 'gacha_pulls', 'gacha_pulls');

select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy'
             and c.relname in ('balances', 'ledger', 'operations', 'galaxies', 'gacha_accounts', 'gacha_state', 'gacha_pulls')),
  'row level security on every new table');

select ok(has_table_privilege('galaxy_api', 'galaxy.ledger', 'select')
      and has_table_privilege('galaxy_api', 'galaxy.ledger', 'insert')
      and not has_table_privilege('galaxy_api', 'galaxy.ledger', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.ledger', 'delete'),
  'galaxy_api: ledger select/insert only');
select ok(not has_table_privilege('galaxy_api', 'galaxy.gacha_pulls', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.gacha_pulls', 'delete')
      and not has_table_privilege('galaxy_api', 'galaxy.operations', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.operations', 'delete'),
  'pull audit and operations cannot be rewritten by the API');
select ok(not has_table_privilege('galaxy_api', 'galaxy.galaxies', 'delete')
      and has_table_privilege('galaxy_api', 'galaxy.galaxies', 'update'),
  'galaxies are never deleted (disintegrated_at instead)');
select ok(not has_table_privilege('anon', 'galaxy.balances', 'select')
      and not has_table_privilege('authenticated', 'galaxy.galaxies', 'select'),
  'only galaxy_api reaches the economy');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000e1', 'pgtap_eco', 'x');

select throws_ok($$insert into galaxy.balances (account_id, currency, amount)
                   values ('00000000-0000-4000-8000-0000000000e1', 'coins', -1)$$,
  '23514', null, 'a balance never goes below 0');
select throws_ok($$insert into galaxy.balances (account_id, currency, amount)
                   values ('00000000-0000-4000-8000-0000000000e1', 'gems', 1)$$,
  '23514', null, 'only known currencies');
select lives_ok($$insert into galaxy.balances (account_id, currency, amount)
                  values ('00000000-0000-4000-8000-0000000000e1', 'signal:nova', 3)$$,
  'event signals are a currency of their own');

insert into galaxy.ledger (account_id, currency, delta, balance_after, reason)
values ('00000000-0000-4000-8000-0000000000e1', 'coins', 100, 100, 'pgTAP');
select throws_ok($$update galaxy.ledger set delta = 1$$, 'P0001', 'append_only', 'the ledger cannot be updated');
select throws_ok($$delete from galaxy.ledger$$, 'P0001', 'append_only', 'the ledger cannot be deleted');

select throws_ok($$insert into galaxy.galaxies (owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin)
                   values ('00000000-0000-4000-8000-0000000000e1', 18446744073709551616, '1.0.0', '{}',
                           repeat('a', 64), 'X', 'GX-AAAAAA', 0, 1, 'normal', 'pull')$$,
  '23514', null, 'a seed is a 64-bit unsigned integer');
select lives_ok($$insert into galaxy.galaxies (owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin)
                  values ('00000000-0000-4000-8000-0000000000e1', 18446744073709551615, '1.0.0', '{}',
                          repeat('a', 64), 'X', 'GX-AAAAAA', 4, 30, 'corrupt', 'pull')$$,
  'the largest 64-bit seed fits');
select throws_ok($$insert into galaxy.gacha_state (account_id, pity_group, since_legendary)
                   values ('00000000-0000-4000-8000-0000000000e1', 'standard', -1)$$,
  '23514', null, 'luck counters are never negative');

select * from finish();
rollback;
