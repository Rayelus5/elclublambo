-- Galaxy Survivor, multiplayer plan phase 6c: the room's chat. A room (in the server's memory, its id a uuid) gets a
-- channel of its own, 'room:<id>', beside 'global' and 'clan:<id>'; its messages are kept, reported and purged like
-- the others (moderation reads them all).
alter table galaxy.chat_messages drop constraint if exists chat_messages_channel_check;
alter table galaxy.chat_messages
  add constraint chat_messages_channel_check
  check (channel = 'global' or channel ~ '^clan:[0-9a-f-]{36}$' or channel ~ '^room:[0-9a-f-]{36}$');
