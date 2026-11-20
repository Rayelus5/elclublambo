-- Galaxy Survivor, plan «escáner pro» part F (migration *_galaxy_player_delete): «Eliminar» anonymises an account; the
-- deletions the API may not make itself (chat, IPs, TOTP, reserving the name) go through galaxy.erase_account, and only
-- for an account already marked deleted.
begin;
select plan(9);

select has_column('galaxy', 'accounts', 'deleted_at', 'accounts.deleted_at');
select ok(has_function_privilege('galaxy_api', 'galaxy.erase_account(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'galaxy.erase_account(uuid,text)', 'execute')
      and not has_function_privilege('authenticated', 'galaxy.erase_account(uuid,text)', 'execute'),
  'only galaxy_api erases');
select ok(not has_table_privilege('galaxy_api', 'galaxy.chat_messages', 'delete')
      and not has_table_privilege('galaxy_api', 'galaxy.account_ips', 'delete')
      and not has_table_privilege('galaxy_api', 'galaxy.reserved_usernames', 'insert'),
  'the API keeps its narrow grants');

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000009f1', 'pgtap_erase', 'x');
insert into galaxy.account_ips (account_id, ip, first_seen, last_seen) values ('00000000-0000-4000-8000-0000000009f1', '10.9.9.9', now(), now());
insert into galaxy.chat_messages (channel, author_id, body) values ('global', '00000000-0000-4000-8000-0000000009f1', 'hola');

select throws_ok($$select galaxy.erase_account('00000000-0000-4000-8000-0000000009f1', null)$$, 'account_not_deleted',
  'an account still in use is not erased');
select is((select count(*)::int from galaxy.chat_messages where author_id = '00000000-0000-4000-8000-0000000009f1'), 1, 'its messages stay');

update galaxy.accounts set deleted_at = now(), username = 'borrado_pgtap01' where id = '00000000-0000-4000-8000-0000000009f1';
select lives_ok($$select galaxy.erase_account('00000000-0000-4000-8000-0000000009f1', 'PgTap_Erase')$$, 'a deleted account is erased');
select is((select count(*)::int from galaxy.chat_messages where author_id = '00000000-0000-4000-8000-0000000009f1'), 0, 'its messages go');
select is((select count(*)::int from galaxy.account_ips where account_id = '00000000-0000-4000-8000-0000000009f1'), 0, 'its IPs go');
select ok(exists (select 1 from galaxy.reserved_usernames where username = 'pgtap_erase'), 'its name is reserved, in lower case');

select * from finish();
rollback;
