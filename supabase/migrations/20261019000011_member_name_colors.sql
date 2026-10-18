-- Author names in the chat take the colour of the member's highest coloured role (not @everyone), as in Discord.
-- Role names and colours are already visible to members; this only joins them per member for the chat directory.

create function public.member_name_colors(p_members uuid[])
returns table (member_id uuid, color text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id,
         (select r.color from public.member_roles mr join public.roles r on r.id = mr.role_id
          where mr.member_id = m.id and not r.is_everyone order by r.position desc limit 1)
  from public.members m
  where public.is_active_member() and m.id = any (p_members[1:500])
$$;

revoke execute on function public.member_name_colors(uuid[]) from public, anon;
grant execute on function public.member_name_colors(uuid[]) to authenticated;
