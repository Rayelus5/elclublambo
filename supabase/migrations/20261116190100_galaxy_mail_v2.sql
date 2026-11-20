-- Mail v2 (2026-11-16): a message's kind (its look in the mailbox) and whether it carried a gift only a superadmin
-- may send; a receipt can be archived or deleted by its player and keeps what each gift gave when it was claimed.
--   mailbox_messages.type      announcement, gift, compensation, event, reward or personal (an admin's), or referral,
--                              shop or system (the game's own); the ones the game sent before are «system».
--   mailbox_messages.big       it needed a superadmin.
--   mailbox_receipts.archived_at / deleted_at   put away / removed by the player (deleted only once its gift is claimed).
--   mailbox_receipts.granted   what each gift gave: given, already owned or not given.

alter table galaxy.mailbox_messages
  add column type text not null default 'announcement'
    check (type in ('announcement', 'gift', 'compensation', 'event', 'reward', 'personal', 'referral', 'shop', 'system')),
  add column big boolean not null default false;
update galaxy.mailbox_messages set type = 'system' where created_by is null;

alter table galaxy.mailbox_receipts
  add column archived_at timestamptz,
  add column deleted_at timestamptz,
  add column granted jsonb check (granted is null or jsonb_typeof(granted) = 'array');
create index mailbox_receipts_account on galaxy.mailbox_receipts (account_id) where deleted_at is null;

grant update (archived_at, deleted_at, granted) on galaxy.mailbox_receipts to galaxy_api;
