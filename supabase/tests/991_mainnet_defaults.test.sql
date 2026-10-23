-- F5 Task 7 (F5-R10): mainnet starts with withdrawals and weighted raffles off, and the active chain is the testnet
-- until the SuperAdmin switches it by hand. Turning either flag on for 59144 is a SuperAdmin decision after legal review.
begin;
select plan(7);

select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'chain_config' and column_name = 'withdrawals_enabled'),
  'false', 'chain_config.withdrawals_enabled defaults to false');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'chain_config' and column_name = 'weighted_raffles_enabled'),
  'false', 'chain_config.weighted_raffles_enabled defaults to false');
select is((select withdrawals_enabled from public.chain_config where chain_id = 59144), false, '59144 withdrawals are off after all migrations');
select is((select weighted_raffles_enabled from public.chain_config where chain_id = 59144), false, '59144 weighted raffles are off after all migrations');
select is((select value from public.app_config where key = 'active_chain_id'), '59141'::jsonb, 'active_chain_id defaults to 59141');
-- P0 Task 1 (P0-R14): Base and Arbitrum mainnet start enabled, and the on-chain legacy DAO starts paused
select is((select array_agg(chain_id order by chain_id) from public.chains where chain_id in (8453, 42161) and enabled),
  '{8453,42161}'::int[], '8453 and 42161 start enabled');
select is((select value from public.app_config where key = 'legacy_dao_enabled'), 'false'::jsonb, 'legacy_dao_enabled defaults to false');

select * from finish();
rollback;
