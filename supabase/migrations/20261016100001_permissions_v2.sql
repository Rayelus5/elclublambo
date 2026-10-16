-- F2a permissions v2: 16-bit permission field, staff seed roles, Verificado role.
--
-- Bits: VIEW_CHANNEL 1, SEND_MESSAGES 2, SEND_IN_THREADS 4, MANAGE_MESSAGES 8, CREATE_INVITES 16,
-- BAN_MEMBERS 32, MANAGE_ROLES 64, MANAGE_CHANNELS 128, MANAGE_TREASURY 256, ADMINISTRATOR 512,
-- ATTACH_FILES 1024, EMBED_LINKS 2048, MENTION_EVERYONE 4096, ADD_REACTIONS 8192,
-- MANAGE_TICKETS 16384, VERIFY_MEMBERS 32768.  ALL_PERMS = 65535.
-- CHANNEL_MASK = 31759 (1|2|4|8|1024|2048|4096|8192|16384): the only bits that may live in a channel overwrite.
-- GLOBAL_MASK  = 65535 & ~31759 = 33776.

-- Stable identity for roles the code depends on (names are editable, system_key is not used by the UI).
alter table public.roles add column system_key text unique;

-- Seed roles (idempotent)
update public.roles set permissions = 8199 where is_everyone;

insert into public.roles (name, color, position, permissions, is_everyone, is_system, system_key) values
  ('Verificado', '#3DDC84', 20,  3072,  false, false, 'verified'),
  ('Soporte',    '#FFB020', 100, 19456, false, false, null),
  ('Moderador',  '#FF5A5A', 500, 56360, false, false, null)
on conflict (name) do nothing;

-- Data migration: every active member and every Padrino holder is Verificado.
-- Private and idempotent; returns the number of rows inserted.
create function public._backfill_verified()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.member_roles (member_id, role_id)
  select m.id, v.id
  from public.members m
  cross join (select id from public.roles where system_key = 'verified') v
  where m.status = 'active'
     or exists (
       select 1
       from public.member_roles mr
       join public.roles p on p.id = mr.role_id and p.name = 'Padrino'
       where mr.member_id = m.id
     )
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public._backfill_verified() from public, anon, authenticated;

select public._backfill_verified();

-- Effective global permissions v2.
-- Admin -> all bits. Otherwise (base & ~deny) | (allow & GLOBAL_MASK): a member override can never
-- grant channel bits (those are only grantable through channel overwrites).
create or replace function public.member_global_permissions(p_member uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base bigint;
  v_allow bigint;
  v_deny bigint;
begin
  select coalesce(bit_or(r.permissions), 0)
    into v_base
  from public.roles r
  where r.is_everyone
     or r.id in (select mr.role_id from public.member_roles mr where mr.member_id = p_member);

  if (v_base & 512) <> 0 then
    return 65535;
  end if;

  select o.allow, o.deny
    into v_allow, v_deny
  from public.member_permission_overrides o
  where o.member_id = p_member;

  return (v_base & ~coalesce(v_deny, 0)) | (coalesce(v_allow, 0) & 33776);
end;
$$;

revoke execute on function public.member_global_permissions(uuid) from public, anon;
grant execute on function public.member_global_permissions(uuid) to authenticated;

-- Grant / remove the Verificado role (pinned by system_key). Needs VERIFY_MEMBERS (admins resolve to all bits); target must be active,
-- not the actor, and strictly below the actor's top role position.
create function public.set_verified(p_member uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_target public.members;
  v_role public.roles;
begin
  v_actor := public.current_member_id();
  if v_actor is null
     or not public.is_active_member()
     or not public.has_global_perm(32768) then
    raise exception 'forbidden';
  end if;

  if p_member is null or p_enabled is null then
    raise exception 'invalid_input';
  end if;

  select * into v_target from public.members m where m.id = p_member for update;
  if not found or v_target.status <> 'active' then
    raise exception 'invalid_input';
  end if;

  if v_target.id = v_actor
     or public.member_top_position(v_target.id) >= public.member_top_position(v_actor) then
    raise exception 'hierarchy';
  end if;

  select * into v_role from public.roles r where r.system_key = 'verified';
  if not found then
    raise exception 'invalid_input';
  end if;

  -- Cannot grant a role above you or carrying bits you do not have.
  if v_role.position >= public.member_top_position(v_actor)
     or (v_role.permissions & ~public.member_global_permissions(v_actor)) <> 0 then
    raise exception 'hierarchy';
  end if;

  if p_enabled then
    insert into public.member_roles (member_id, role_id)
    values (v_target.id, v_role.id)
    on conflict do nothing;
  else
    delete from public.member_roles where member_id = v_target.id and role_id = v_role.id;
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'member_verified_set', 'member', v_target.id,
          jsonb_build_object('enabled', p_enabled));
end;
$$;

revoke execute on function public.set_verified(uuid, boolean) from public, anon;
grant execute on function public.set_verified(uuid, boolean) to authenticated;
