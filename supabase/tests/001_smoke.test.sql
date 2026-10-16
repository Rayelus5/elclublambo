begin;
select plan(3);

select has_extension('pgtap');

select set_config(
  'tests.uid',
  tests.create_wallet_user('0x1111111111111111111111111111111111111111')::text,
  true
);
select is(
  (select user_id::text from auth.identities
    where provider_id = 'web3:ethereum:0x1111111111111111111111111111111111111111'),
  current_setting('tests.uid'),
  'create_wallet_user inserts auth.users + auth.identities'
);

select tests.authenticate_as(current_setting('tests.uid')::uuid);
select is(
  auth.uid()::text,
  current_setting('tests.uid'),
  'authenticate_as sets role authenticated and auth.uid()'
);
select tests.clear_authentication();

select * from finish();
rollback;
