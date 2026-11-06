-- Galaxy Survivor M1 Task 2 (migration 20261107100001_galaxy_foundation): schema galaxy, invisible to the API roles,
-- reachable only by galaxy_api with per-table grants; append-only audit log; galaxy.rate_limit like private.rate_limit.
begin;
select plan(30);

select has_schema('galaxy');
select has_table('galaxy', 'accounts', 'accounts');
select has_table('galaxy', 'account_roles', 'account_roles');
select has_table('galaxy', 'reserved_usernames', 'reserved_usernames');
select has_table('galaxy', 'sessions', 'sessions');
select has_table('galaxy', 'login_challenges', 'login_challenges');
select has_table('galaxy', 'admin_totp', 'admin_totp');
select has_table('galaxy', 'reset_codes', 'reset_codes');
select has_table('galaxy', 'rate_limit_hits', 'rate_limit_hits');
select has_table('galaxy', 'admin_audit_log', 'admin_audit_log');

select ok(not exists (select 1 from pg_tables where schemaname = 'galaxy' and not rowsecurity), 'RLS on every galaxy table');

-- Visibility.
select ok(not has_schema_privilege('anon', 'galaxy', 'usage')
      and not has_schema_privilege('authenticated', 'galaxy', 'usage')
      and not has_schema_privilege('service_role', 'galaxy', 'usage'),
  'no API role can use schema galaxy');
select ok(has_schema_privilege('galaxy_api', 'galaxy', 'usage'), 'galaxy_api can use schema galaxy');
select ok(not has_schema_privilege('galaxy_api', 'galaxy', 'create'), 'galaxy_api cannot create objects in galaxy');
select ok(not has_table_privilege('galaxy_api', 'public.members', 'select'), 'galaxy_api cannot read the forum');
select ok(has_table_privilege('galaxy_api', 'galaxy.accounts', 'select')
      and has_table_privilege('galaxy_api', 'galaxy.accounts', 'insert')
      and not has_table_privilege('galaxy_api', 'galaxy.accounts', 'delete'),
  'galaxy_api: accounts select/insert, never delete');
select ok(has_table_privilege('galaxy_api', 'galaxy.admin_audit_log', 'insert')
      and not has_table_privilege('galaxy_api', 'galaxy.admin_audit_log', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.admin_audit_log', 'delete'),
  'galaxy_api: audit log insert only (plus select)');
select ok(not has_table_privilege('galaxy_api', 'galaxy.rate_limit_hits', 'select')
      and not has_table_privilege('galaxy_api', 'galaxy.rate_limit_hits', 'insert'),
  'galaxy_api never touches rate_limit_hits directly');
select ok(not has_table_privilege('galaxy_api', 'galaxy.reserved_usernames', 'insert'), 'galaxy_api cannot add reserved names');
select ok(has_function_privilege('galaxy_api', 'galaxy.rate_limit(text,text,int,interval)', 'execute')
      and not has_function_privilege('anon', 'galaxy.rate_limit(text,text,int,interval)', 'execute')
      and not has_function_privilege('authenticated', 'galaxy.rate_limit(text,text,int,interval)', 'execute'),
  'only galaxy_api executes galaxy.rate_limit');

-- Accounts.
select throws_ok($$insert into galaxy.accounts (username, password_hash) values ('Rayelus', 'x')$$, '23514', null,
  'usernames are stored lowercase only');
select throws_ok($$insert into galaxy.accounts (username, password_hash) values ('ab', 'x')$$, '23514', null,
  'usernames shorter than 3 are rejected');
insert into galaxy.accounts (username, password_hash) values ('t970_pilot', 'x');
select throws_ok($$insert into galaxy.accounts (username, password_hash) values ('t970_pilot', 'y')$$, '23505', null,
  'usernames are unique');
select ok(exists (select 1 from galaxy.reserved_usernames where username = 'rayelus'), 'rayelus is reserved');

-- Sessions: the token hash is unique.
insert into galaxy.sessions (account_id, token_hash, expires_at)
select id, '\x01'::bytea, now() + interval '1 day' from galaxy.accounts where username = 't970_pilot';
select throws_ok($$insert into galaxy.sessions (account_id, token_hash, expires_at)
                   select id, '\x01'::bytea, now() + interval '1 day' from galaxy.accounts where username = 't970_pilot'$$,
  '23505', null, 'session token hashes are unique');

-- Append-only audit log.
insert into galaxy.admin_audit_log (actor_label, action, reason) values ('test', 'test.action', 'pgTAP');
select throws_ok($$update galaxy.admin_audit_log set reason = 'x'$$, 'P0001', 'audit_log_is_append_only', 'audit rows cannot be updated');
select throws_ok($$delete from galaxy.admin_audit_log$$, 'P0001', 'audit_log_is_append_only', 'audit rows cannot be deleted');

-- Rate limit.
select lives_ok($$select galaxy.rate_limit('ip:t970', 't970', 2, '1 minute') from generate_series(1, 2)$$, 'two hits fit a max of 2');
select throws_ok($$select galaxy.rate_limit('ip:t970', 't970', 2, '1 minute')$$, 'P0001', 'rate_limited', 'the third hit is rate_limited');
select lives_ok($$select galaxy.rate_limit(null, 't970', 1, '1 minute') from generate_series(1, 3)$$, 'a null subject is a no-op');

select * from finish();
rollback;
