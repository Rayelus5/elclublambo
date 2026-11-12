-- Galaxy Survivor, plan «escáner pro» part F (the owner: «poder eliminarlos» desde la lista de jugadores del admin).
-- A full delete is impossible without breaking history (append-only ledger, runs and pulls; Stripe purchases kept by
-- law; other players' trades and sales), so «Eliminar» anonymises and closes the account: it keeps its row with a
-- placeholder name, an unusable password and this date; its personal and social data go. The API may now delete what
-- that needs and reserve the old name when the admin asks.

alter table galaxy.accounts add column deleted_at timestamptz;

grant delete on galaxy.account_ips, galaxy.social_prefs, galaxy.chat_messages, galaxy.admin_totp to galaxy_api;
grant insert on galaxy.reserved_usernames to galaxy_api;
