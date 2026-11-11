-- Galaxy Survivor, shop and lab plan F4 (migration *_galaxy_shop): the resource shop's purchases, Stripe events,
-- alerts and blocks. Real money: a purchase keeps its account, an event is handled once, the first-purchase extra is
-- reserved once per product while the purchase is alive.
begin;
select plan(14);

select has_table('galaxy', 'shop_purchases', 'shop_purchases');
select has_table('galaxy', 'shop_stripe_events', 'shop_stripe_events');
select has_table('galaxy', 'shop_alerts', 'shop_alerts');
select has_table('galaxy', 'shop_blocks', 'shop_blocks');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('shop_purchases', 'shop_stripe_events', 'shop_alerts', 'shop_blocks')),
  'row level security on every shop table');
select ok(not has_table_privilege('galaxy_api', 'galaxy.shop_purchases', 'delete')
      and not has_table_privilege('galaxy_api', 'galaxy.shop_stripe_events', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.shop_stripe_events', 'delete'),
  'purchases are never deleted and handled events never change');
select ok(not has_table_privilege('anon', 'galaxy.shop_purchases', 'select')
      and not has_table_privilege('authenticated', 'galaxy.shop_purchases', 'select')
      and not has_table_privilege('service_role', 'galaxy.shop_purchases', 'select'),
  'only galaxy_api reaches the purchases');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000f6', 'pgtap_shop', 'x');

select lives_ok($$insert into galaxy.shop_purchases (id, account_id, product, snapshot, amount_cents, stripe_price_id, first_bonus, consent_at, terms_version, madrid_day, expires_at)
                  values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f6', 'coins-1', '{}', 399, 'price_A1', true, now(), 'v1', current_date, now() + interval '35 minutes')$$,
  'a purchase opened with its first-purchase extra');
select throws_ok($$insert into galaxy.shop_purchases (account_id, product, snapshot, amount_cents, stripe_price_id, first_bonus, consent_at, terms_version, madrid_day, expires_at)
                   values ('00000000-0000-4000-8000-0000000000f6', 'coins-1', '{}', 399, 'price_A1', true, now(), 'v1', current_date, now() + interval '35 minutes')$$,
  '23505', null, 'the first-purchase extra of a product is reserved once');
update galaxy.shop_purchases set status = 'expired' where id = '00000000-0000-4000-8000-0000000000a1';
select lives_ok($$insert into galaxy.shop_purchases (account_id, product, snapshot, amount_cents, stripe_price_id, first_bonus, consent_at, terms_version, madrid_day, expires_at)
                  values ('00000000-0000-4000-8000-0000000000f6', 'coins-1', '{}', 399, 'price_A1', true, now(), 'v1', current_date, now() + interval '35 minutes')$$,
  'an expired payment frees it');
select throws_ok($$update galaxy.shop_purchases set status = 'paid' where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'a paid purchase has its time and what it gave');
select throws_ok($$delete from galaxy.accounts where id = '00000000-0000-4000-8000-0000000000f6'$$,
  '23503', null, 'an account with purchases is never deleted');
select lives_ok($$insert into galaxy.shop_stripe_events (id, type, purchase_id) values ('evt_1abc', 'checkout.session.completed', '00000000-0000-4000-8000-0000000000a1')$$,
  'a handled event');
select throws_ok($$insert into galaxy.shop_stripe_events (id, type) values ('evt_1abc', 'checkout.session.completed')$$,
  '23505', null, 'the same event twice');

select * from finish();
rollback;
