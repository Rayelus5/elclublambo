-- F3c: a bounty's lifecycle changes (solution marked, cancelled, paid) are broadcast on the channel's private topic so
-- other viewers refresh the card without reloading. Same pattern, topic and receive policy as
-- 20261016200004_message_realtime.sql; the payload carries ids only ({id = bounty message id, channel_id,
-- thread_root_id}) and clients re-read through RLS (bounty_details).
create function public.broadcast_bounty_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.solution_marked_at is distinct from old.solution_marked_at
     or new.cancelled_at is distinct from old.cancelled_at
     or new.paid_at is distinct from old.paid_at then
    perform realtime.send(
      jsonb_build_object('id', new.message_id, 'channel_id', new.channel_id, 'thread_root_id', null),
      'bounty_changed',
      'channel:' || new.channel_id::text,
      true
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.broadcast_bounty_event() from public, anon, authenticated, service_role;

create trigger bounties_broadcast_update after update on public.bounties
  for each row execute function public.broadcast_bounty_event();
