-- F3b Task 5 fix: exact per-token totals of the tips a member received on one chain, uncapped.
-- Same visibility as member_tips (profile tips, or tips on non-deleted messages in channels the caller can see).
create function public.member_tips_totals(p_member uuid, p_chain int)
returns table (token text, total_text text, tip_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select t.token, sum(t.amount)::text, count(*)::int
  from public.tips t
  left join public.messages m on m.id = t.message_id
  where public.is_active_member()
    and t.to_member = p_member
    and t.chain_id = p_chain
    and (t.target_type = 'profile'
         or (m.id is not null and m.deleted_at is null
             and m.channel_id in (select v.id from public.visible_channels() v)))
  group by t.token
$$;

revoke execute on function public.member_tips_totals(uuid, int) from public, anon, authenticated, service_role;
grant execute on function public.member_tips_totals(uuid, int) to authenticated;
