-- F2b spike: private realtime broadcast authorization.
-- Temporary: Task 5 absorbs the policy and replaces the helper with triggers.

-- Receive authorization: only members who can view the channel.
-- The regex check is validated BEFORE the uuid cast (an invalid cast would break the policy).
create policy "realtime_receive_channel_topics"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() ~ '^channel:[0-9a-f-]{36}$'
    and public.can_view(substring(realtime.topic() from 9)::uuid)
  );

-- Test helper: emits an id-only broadcast to the channel's private topic.
create function public._spike_emit(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', gen_random_uuid(), 'channel_id', p_channel),
    'message_created',
    'channel:' || p_channel::text,
    true
  );
end;
$$;

revoke execute on function public._spike_emit(uuid) from public, anon, authenticated;
grant execute on function public._spike_emit(uuid) to service_role;
