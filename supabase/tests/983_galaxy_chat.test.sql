-- Galaxy Survivor M5b-2 Task 2 (migration *_galaxy_chat): the chats' messages (hidden, never deleted), their reports
-- (one per account and message) and the mutes moderators set.
begin;
select plan(13);

select has_table('galaxy', 'chat_messages', 'chat_messages');
select has_table('galaxy', 'chat_reports', 'chat_reports');
select has_table('galaxy', 'chat_mutes', 'chat_mutes');
select col_is_pk('galaxy', 'chat_reports', array['message_id', 'reporter_id'], 'one report per account and message');
select col_is_pk('galaxy', 'chat_mutes', 'account_id', 'one mute per account');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('chat_messages', 'chat_reports', 'chat_mutes')),
  'row level security on the three tables');
select ok(has_table_privilege('galaxy_api', 'galaxy.chat_messages', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.chat_messages', 'delete')
      and not has_table_privilege('anon', 'galaxy.chat_messages', 'select')
      and not has_table_privilege('authenticated', 'galaxy.chat_reports', 'select'),
  'galaxy_api hides messages and never deletes them; nobody else reaches the chat');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000d1', 'pgtap_chat', 'x');

select lives_ok($$insert into galaxy.chat_messages (channel, author_id, body) values ('global', '00000000-0000-4000-8000-0000000000d1', 'hola')$$,
  'a message in the global channel');
select lives_ok($$insert into galaxy.chat_messages (channel, author_id, body) values ('clan:00000000-0000-4000-8000-00000000c1a0', '00000000-0000-4000-8000-0000000000d1', 'hola clan')$$,
  'a message in a clan channel');
select throws_ok($$insert into galaxy.chat_messages (channel, author_id, body) values ('general', '00000000-0000-4000-8000-0000000000d1', 'x')$$,
  '23514', null, 'only the global channel or a clan''s');
select throws_ok($$insert into galaxy.chat_messages (channel, author_id, body) values ('global', '00000000-0000-4000-8000-0000000000d1', '')$$,
  '23514', null, 'a message is not empty');
select throws_ok($$insert into galaxy.chat_messages (channel, author_id, body) values ('global', '00000000-0000-4000-8000-0000000000d1', repeat('x', 1001))$$,
  '23514', null, 'a message keeps 1000 characters at most');
select throws_ok($$update galaxy.chat_messages set hidden_at = now(), hidden_reason = 'boredom' where author_id = '00000000-0000-4000-8000-0000000000d1'$$,
  '23514', null, 'a message is hidden by a moderator or by reports');

select * from finish();
rollback;
