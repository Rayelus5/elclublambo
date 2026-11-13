-- Galaxy Survivor, plan «referidos» (migration *_galaxy_referrals): codes in capitals and unique, a newcomer never their
-- own owner, a state from the list, reached by the API only, gone with the accounts.
begin;
select plan(7);

select has_table('galaxy', 'referral_codes', 'referral_codes');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('referral_codes', 'referral_rewards', 'referrals'))
      and has_table_privilege('galaxy_api', 'galaxy.referrals', 'select, insert, update')
      and not has_table_privilege('anon', 'galaxy.referral_codes', 'select'),
  'row level security on; only the API reaches them');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000009a1', 'pgtap_ref_owner', 'x'),
  ('00000000-0000-4000-8000-0000000009a2', 'pgtap_ref_new', 'x');
insert into galaxy.referral_codes (id, code, owner_id) values ('00000000-0000-4000-8000-0000000009c1', 'PGTAP-REF', '00000000-0000-4000-8000-0000000009a1');
select throws_ok($$insert into galaxy.referral_codes (code, owner_id) values ('pgtap-ref', '00000000-0000-4000-8000-0000000009a1')$$, '23514', null, 'codes are in capitals');
select throws_ok($$insert into galaxy.referral_codes (code, owner_id) values ('PGTAP-REF', '00000000-0000-4000-8000-0000000009a2')$$, '23505', null, 'a code is unique');
select throws_ok($$insert into galaxy.referrals (account_id, code_id, owner_id) values ('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-0000000009a1')$$, '23514', null, 'nobody refers themselves');
select throws_ok($$insert into galaxy.referrals (account_id, code_id, owner_id, state) values ('00000000-0000-4000-8000-0000000009a2', '00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-0000000009a1', 'paid')$$, '23514', null, 'a state from the list');
insert into galaxy.referrals (account_id, code_id, owner_id) values ('00000000-0000-4000-8000-0000000009a2', '00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-0000000009a1');
delete from galaxy.accounts where id = '00000000-0000-4000-8000-0000000009a1';
select is((select count(*)::int from galaxy.referrals where account_id = '00000000-0000-4000-8000-0000000009a2'), 0, 'gone with the owner');

select * from finish();
rollback;
