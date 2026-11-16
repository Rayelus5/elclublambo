-- Scheduled mail (mail v2, P5): a message written now and sent at its time.
--   scheduled_at  when it goes out (null: at once).
--   sent_at       when its receipts were written (null: still waiting). Every insert that does not say gets now(): the
--                 messages sent at once and the game's own. The ones sent before, at their creation.
-- A scheduled message's created_at becomes the moment it is sent (its date in the mailbox); when it was written stays
-- in the audit.

alter table galaxy.mailbox_messages
  add column scheduled_at timestamptz,
  add column sent_at timestamptz default now();
update galaxy.mailbox_messages set sent_at = created_at;
create index mailbox_messages_due on galaxy.mailbox_messages (scheduled_at) where sent_at is null and withdrawn_at is null;

grant update (sent_at, created_at) on galaxy.mailbox_messages to galaxy_api;
