-- Chat density (standard / compact), a per-member preference for every text channel, changed from any channel or the
-- profile. Stored on the member so it follows them across devices; only set_chat_density writes it.

alter table public.members add column chat_density text not null default 'standard'
  check (chat_density in ('standard', 'compact'));

create function public.set_chat_density(p_density text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_density is null or p_density not in ('standard', 'compact') then
    raise exception 'invalid_input';
  end if;
  update public.members set chat_density = p_density where id = v_me;
end;
$$;

revoke execute on function public.set_chat_density(text) from public, anon;
grant execute on function public.set_chat_density(text) to authenticated;
