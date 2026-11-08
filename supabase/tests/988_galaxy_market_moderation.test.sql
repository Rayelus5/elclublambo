-- Galaxy Survivor M6c-2 Task 1 (migration *_galaxy_market_moderation): a deal reverted by an admin (one reversal per
-- listing or trade, never both) and the review of a trade alert (who, when and why, all three or none).
begin;
select plan(11);

select has_table('galaxy', 'deal_reversals', 'deal_reversals');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'deal_reversals'),
  'row level security on deal_reversals');
select ok(has_table_privilege('galaxy_api', 'galaxy.deal_reversals', 'select, insert')
      and not has_table_privilege('galaxy_api', 'galaxy.deal_reversals', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.deal_reversals', 'delete')
      and not has_table_privilege('anon', 'galaxy.deal_reversals', 'select'),
  'a reversal is written once and never changed; nobody else reaches it');
select has_column('galaxy', 'trade_alerts', 'reviewed_at', 'an alert can be reviewed');
select ok(has_column_privilege('galaxy_api', 'galaxy.trade_alerts', 'reviewed_at', 'update')
      and not has_column_privilege('galaxy_api', 'galaxy.trade_alerts', 'details', 'update'),
  'galaxy_api records the review and nothing else of an alert');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f1', 'pgtap_rev_a', 'x'),
  ('00000000-0000-4000-8000-0000000000f2', 'pgtap_rev_b', 'x');
insert into galaxy.trades (id, a_id, b_id, expires_at) values
  ('00000000-0000-4000-8000-00000000f7a0', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', now() + interval '1 day');

select lives_ok($$insert into galaxy.deal_reversals (trade_id, by_id, reason) values ('00000000-0000-4000-8000-00000000f7a0', '00000000-0000-4000-8000-0000000000f1', 'Fraude entre cuentas')$$,
  'a trade reverted');
select throws_ok($$insert into galaxy.deal_reversals (trade_id, reason) values ('00000000-0000-4000-8000-00000000f7a0', 'Otra vez')$$,
  '23505', null, 'a trade is reverted once');
select throws_ok($$insert into galaxy.deal_reversals (reason) values ('Nada que revertir')$$,
  '23514', null, 'a reversal names its listing or its trade');
select throws_ok($$insert into galaxy.deal_reversals (trade_id, reason) values ('00000000-0000-4000-8000-00000000f7a0', 'no')$$,
  '23514', null, 'a reversal has a reason of 3 to 300 characters');

insert into galaxy.trade_alerts (kind, trade_id, seller_id, buyer_id) values
  ('shared_ip', '00000000-0000-4000-8000-00000000f7a0', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2');
select throws_ok($$update galaxy.trade_alerts set reviewed_at = now() where trade_id = '00000000-0000-4000-8000-00000000f7a0'$$,
  '23514', null, 'a review says why');
select lives_ok($$update galaxy.trade_alerts set reviewed_at = now(), reviewed_by = '00000000-0000-4000-8000-0000000000f1', review_reason = 'Hermanos que juegan juntos' where trade_id = '00000000-0000-4000-8000-00000000f7a0'$$,
  'an alert reviewed');

select * from finish();
rollback;
