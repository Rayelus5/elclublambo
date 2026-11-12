-- Galaxy Survivor, plan «escáner pro» part F (the owner: «poder eliminarlos» desde la lista de jugadores del admin).
-- A full delete is impossible without breaking history (append-only ledger, runs and pulls; Stripe purchases kept by
-- law; other players' trades and sales), so «Eliminar» anonymises and closes the account: it keeps its row with a
-- placeholder name, an unusable password and this date; its personal and social data go.
--
-- The API keeps its narrow grants: it may still not delete chat messages (moderation's evidence), IPs (the market's
-- fraud checks) or TOTP secrets, nor add reserved names. The few deletions that need them go through
-- galaxy.erase_account, which only acts on an account already marked deleted (in the same transaction).

alter table galaxy.accounts add column deleted_at timestamptz;

create function galaxy.erase_account(p_account uuid, p_reserve text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from galaxy.accounts a where a.id = p_account and a.deleted_at is not null) then
    raise exception 'account_not_deleted';
  end if;
  delete from galaxy.account_ips where account_id = p_account;
  delete from galaxy.social_prefs where account_id = p_account;
  delete from galaxy.chat_messages where author_id = p_account;
  delete from galaxy.admin_totp where account_id = p_account;
  if p_reserve is not null then
    insert into galaxy.reserved_usernames (username) values (lower(p_reserve)) on conflict do nothing;
  end if;
end;
$$;

revoke all on function galaxy.erase_account(uuid, text) from public, anon, authenticated, service_role;
grant execute on function galaxy.erase_account(uuid, text) to galaxy_api;
