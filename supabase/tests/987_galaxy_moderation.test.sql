-- Galaxy Survivor M6c-1 Task 1 (migration *_galaxy_chat_report_reviews): the last review of each reported message,
-- so the report queue holds only what came after it. Gone with its message; never readable by anyone but the API.
begin;
select plan(9);

select has_table('galaxy', 'chat_report_reviews', 'chat_report_reviews');
select col_is_pk('galaxy', 'chat_report_reviews', 'message_id', 'one review per message (its last one)');
select col_not_null('galaxy', 'chat_report_reviews', 'reviewed_at', 'a review has its time');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'chat_report_reviews'),
  'row level security on chat_report_reviews');
select ok(has_table_privilege('galaxy_api', 'galaxy.chat_report_reviews', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.chat_report_reviews', 'delete')
      and not has_table_privilege('anon', 'galaxy.chat_report_reviews', 'select')
      and not has_table_privilege('authenticated', 'galaxy.chat_report_reviews', 'select'),
  'galaxy_api records reviews; nobody else reaches them');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000e1', 'pgtap_mod', 'x');
insert into galaxy.chat_messages (channel, author_id, body) values ('global', '00000000-0000-4000-8000-0000000000e1', 'hola');

select lives_ok($$insert into galaxy.chat_report_reviews (message_id, outcome, by_id, reason)
  select id, 'kept', '00000000-0000-4000-8000-0000000000e1', 'No es ofensivo' from galaxy.chat_messages where author_id = '00000000-0000-4000-8000-0000000000e1'$$,
  'a message kept visible');
select throws_ok($$update galaxy.chat_report_reviews set outcome = 'deleted'$$, '23514', null, 'a review hides or keeps');
select throws_ok($$update galaxy.chat_report_reviews set reason = 'no'$$, '23514', null, 'a review has a reason of 3 to 300 characters');

delete from galaxy.accounts where id = '00000000-0000-4000-8000-0000000000e1';
select is((select count(*)::int from galaxy.chat_report_reviews r join galaxy.chat_messages m on m.id = r.message_id
           where m.author_id = '00000000-0000-4000-8000-0000000000e1'), 0, 'the review goes with its message');

select * from finish();
rollback;
