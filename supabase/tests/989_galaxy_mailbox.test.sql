-- Galaxy Survivor M6d-1 Task 1 (migration *_galaxy_mailbox): the mailbox's messages (gifts and audience as objects,
-- withdrawn but never deleted), one receipt per message and account (read, claimed), and the title-screen notices.
begin;
select plan(12);

select has_table('galaxy', 'mailbox_messages', 'mailbox_messages');
select has_table('galaxy', 'mailbox_receipts', 'mailbox_receipts');
select has_table('galaxy', 'title_notices', 'title_notices');
select col_is_pk('galaxy', 'mailbox_receipts', array['message_id', 'account_id'], 'one receipt per message and account');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname in ('mailbox_messages', 'mailbox_receipts', 'title_notices')),
  'row level security on the three tables');
select ok(has_table_privilege('galaxy_api', 'galaxy.mailbox_messages', 'select, insert')
      and has_column_privilege('galaxy_api', 'galaxy.mailbox_messages', 'withdrawn_at', 'update')
      and not has_column_privilege('galaxy_api', 'galaxy.mailbox_messages', 'gifts', 'update')
      and not has_table_privilege('galaxy_api', 'galaxy.mailbox_messages', 'delete')
      and not has_table_privilege('anon', 'galaxy.mailbox_receipts', 'select'),
  'a message is withdrawn, never edited or deleted; nobody else reaches the mailbox');

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000000a9', 'pgtap_mail', 'x');

select lives_ok($$insert into galaxy.mailbox_messages (id, title, body, gifts, audience, expires_at) values
  ('00000000-0000-4000-8000-00000000aa11', 'Hola', 'Bienvenida', '{"coins": 100}', '{"kind": "all"}', now() + interval '30 days')$$,
  'a message for everyone with a gift');
select throws_ok($$insert into galaxy.mailbox_messages (title, body, gifts, audience, expires_at) values ('', 'x', '{}', '{"kind": "all"}', now() + interval '1 day')$$,
  '23514', null, 'a message has a title');
select throws_ok($$insert into galaxy.mailbox_messages (title, body, gifts, audience, expires_at) values ('Hola', 'x', '[]', '{"kind": "all"}', now() + interval '1 day')$$,
  '23514', null, 'gifts are an object');
select throws_ok($$insert into galaxy.mailbox_receipts (message_id, account_id, claimed_at) values ('00000000-0000-4000-8000-00000000aa11', '00000000-0000-4000-8000-0000000000a9', now())$$,
  '23514', null, 'a gift is claimed by who read it');
select throws_ok($$insert into galaxy.title_notices (text, tone, starts_at, ends_at) values ('Aviso', 'info', now(), now() - interval '1 hour')$$,
  '23514', null, 'a notice ends after it starts');
select throws_ok($$insert into galaxy.title_notices (text, tone, starts_at, ends_at) values ('Aviso', 'alarm', now(), now() + interval '1 hour')$$,
  '23514', null, 'a notice is info or a warning');

select * from finish();
rollback;
