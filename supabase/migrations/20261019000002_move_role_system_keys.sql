-- Roles drag & drop (settings): the SuperAdmin may now reorder the system_key roles (Verificado, Padrino) too;
-- SuperAdmin and @everyone stay pinned, and delegates with MANAGE_ROLES still cannot move system_key roles.
-- Supersedes the "system_key roles are not movable" rule of 20261016100006_f2a_hardening.sql (point 4).

create or replace function public.move_role(p_role uuid, p_position int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_admin boolean;
  v_top int;
  v_role public.roles;
  v_end int;
begin
  perform pg_advisory_xact_lock(hashtext('public.roles'));

  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(64) then
    raise exception 'forbidden';
  end if;
  if p_role is null or p_position is null then
    raise exception 'invalid_input';
  end if;

  select * into v_role from public.roles r where r.id = p_role for update;
  if not found then
    raise exception 'invalid_input';
  end if;
  if v_role.is_system or v_role.is_everyone then
    raise exception 'forbidden';
  end if;

  v_admin := (public.member_global_permissions(v_actor) & 512) <> 0;
  -- Roles held by everyone they are given to (Verificado, Padrino): only the SuperAdmin reorders them.
  if v_role.system_key is not null and not v_admin then
    raise exception 'forbidden';
  end if;
  v_top := public.member_top_position(v_actor);
  if not v_admin and v_role.position >= v_top then
    raise exception 'hierarchy';
  end if;
  if p_position < 1 or p_position >= v_top then
    raise exception 'hierarchy';
  end if;

  -- Make room: shift only the contiguous run of occupied positions starting at the target slot.
  with recursive run(pos) as (
    select p_position
    where exists (select 1 from public.roles r
                  where r.position = p_position and r.id <> p_role and not r.is_everyone and not r.is_system)
    union all
    select run.pos + 1 from run
    where exists (select 1 from public.roles r
                  where r.position = run.pos + 1 and r.id <> p_role and not r.is_everyone and not r.is_system)
  )
  select max(pos) into v_end from run;

  if v_end is not null then
    if v_end + 1 >= v_top then
      raise exception 'hierarchy';
    end if;
    update public.roles r set position = r.position + 1
    where r.position between p_position and v_end and r.id <> p_role and not r.is_everyone and not r.is_system;
  end if;

  update public.roles set position = p_position where id = p_role;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'role_moved', 'role', p_role,
          jsonb_build_object('name', v_role.name, 'from_position', v_role.position, 'to_position', p_position));
end;
$$;
