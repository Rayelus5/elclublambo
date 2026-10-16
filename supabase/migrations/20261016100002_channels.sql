-- F2a channel tree: categories -> nested forums -> text channels, plus per-channel permission overwrites.
-- Writes happen only through later SECURITY DEFINER RPCs; RLS policies arrive with the permission functions.

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.channels (id) on delete restrict,
  kind text not null check (kind in ('category', 'forum', 'text')),
  name text not null check (char_length(btrim(name)) between 1 and 50),
  topic text check (char_length(topic) <= 300),
  position int not null default 0,
  slowmode_seconds int not null default 0 check (slowmode_seconds = 0 or slowmode_seconds between 5 and 604800),
  tickets_enabled boolean not null default false,
  alpha_enabled boolean not null default false,
  gate_mode text not null default 'none' check (gate_mode in ('none', 'min_share_bps', 'min_net_usdc')),
  gate_value numeric,
  gate_scope text not null default 'view' check (gate_scope in ('view', 'post')),
  created_by uuid references public.members (id),
  created_at timestamptz not null default now(),
  check (kind = 'text' or (not tickets_enabled and not alpha_enabled))
);
create index channels_parent_position_idx on public.channels (parent_id, position);
create index channels_created_by_idx on public.channels (created_by);

create table public.permission_overwrites (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  target_type text not null check (target_type in ('role', 'member')),
  target_id uuid not null,
  allow bigint not null default 0 check ((allow & ~31759::bigint) = 0),
  deny bigint not null default 0 check ((deny & ~31759::bigint) = 0),
  unique (channel_id, target_type, target_id),
  check ((allow & deny) = 0)
);
create index permission_overwrites_target_idx on public.permission_overwrites (target_type, target_id);

-- Tree integrity. depth = nodes on the path root..node (root category = 1).
create function public.channels_tree_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_kind text;
  v_parent_depth int;
  v_height int;
begin
  if new.parent_id is null then
    if new.kind <> 'category' then
      raise exception 'invalid_tree';
    end if;
    v_parent_depth := 0;
  else
    if new.parent_id = new.id then
      raise exception 'invalid_tree';
    end if;
    if new.kind = 'category' then
      raise exception 'invalid_tree';
    end if;
    select kind into v_parent_kind from public.channels where id = new.parent_id;
    if v_parent_kind is null or v_parent_kind not in ('category', 'forum') then
      raise exception 'invalid_tree';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- a node with children cannot become a leaf (text)
    if new.kind = 'text' and exists (select 1 from public.channels where parent_id = new.id) then
      raise exception 'invalid_tree';
    end if;
    -- only re-check the position in the tree when parent or kind changed
    if new.parent_id is not distinct from old.parent_id and new.kind = old.kind then
      return new;
    end if;
    -- cycle: the new parent must not be a descendant of this node
    if new.parent_id is not null and exists (
      with recursive d as (
        select c.id from public.channels c where c.parent_id = new.id
        union all
        select c.id from public.channels c join d on c.parent_id = d.id
      )
      select 1 from d where d.id = new.parent_id
    ) then
      raise exception 'invalid_tree';
    end if;
  end if;

  if new.parent_id is not null then
    with recursive a as (
      select c.id, c.parent_id, 1 as depth from public.channels c where c.id = new.parent_id
      union all
      select c.id, c.parent_id, a.depth + 1 from public.channels c join a on c.id = a.parent_id
    )
    select count(*) into v_parent_depth from a;
  end if;

  -- height of the moving subtree (the node itself = 1); new rows have no descendants
  if tg_op = 'UPDATE' then
    with recursive s as (
      select c.id, 1 as h from public.channels c where c.parent_id = new.id
      union all
      select c.id, s.h + 1 from public.channels c join s on c.parent_id = s.id
    )
    select coalesce(max(h), 0) + 1 into v_height from s;
  else
    v_height := 1;
  end if;

  if v_parent_depth + v_height > 6 then
    raise exception 'depth_limit';
  end if;

  return new;
end;
$$;

create trigger channels_tree_guard
  before insert or update on public.channels
  for each row execute function public.channels_tree_guard();

-- Logical FKs: overwrites follow the lifetime of their role / member target.
create function public.overwrites_cleanup_on_role_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.permission_overwrites where target_type = 'role' and target_id = old.id;
  return old;
end;
$$;

create function public.overwrites_cleanup_on_member_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.permission_overwrites where target_type = 'member' and target_id = old.id;
  return old;
end;
$$;

create trigger roles_overwrites_cleanup
  after delete on public.roles
  for each row execute function public.overwrites_cleanup_on_role_delete();

create trigger members_overwrites_cleanup
  after delete on public.members
  for each row execute function public.overwrites_cleanup_on_member_delete();

revoke execute on function public.channels_tree_guard() from public, anon, authenticated;
revoke execute on function public.overwrites_cleanup_on_role_delete() from public, anon, authenticated;
revoke execute on function public.overwrites_cleanup_on_member_delete() from public, anon, authenticated;

-- RLS deny-by-default (policies in the next migration); no direct writes for API roles.
alter table public.channels enable row level security;
alter table public.permission_overwrites enable row level security;

revoke all on public.channels from anon;
revoke all on public.permission_overwrites from anon;
revoke insert, update, delete, truncate on public.channels from authenticated;
revoke insert, update, delete, truncate on public.permission_overwrites from authenticated;
