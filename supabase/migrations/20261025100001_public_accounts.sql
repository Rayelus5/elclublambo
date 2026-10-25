-- P2 Task 3: public accounts. A public account is any signed-in wallet (same SIWE session as the club) that is not a
-- banned club member. Club data stays behind is_active_member(); this only answers "may this session use public tools?".
create function public.is_public_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and public.auth_wallet_address() is not null
    and not exists (
      select 1 from public.members m
      where m.auth_user_id = auth.uid() and m.status = 'banned'
    )
$$;

revoke execute on function public.is_public_account() from public, anon;
grant execute on function public.is_public_account() to authenticated;
