-- F5 Task 2 follow-up:
--   Ruling F5-R17: members with ADMINISTRATOR (512) are exempt from the invite_create bucket. A SuperAdmin onboarding
--   a cohort may need more than 30 invite links in a day; everyone else with CREATE_INVITES keeps 30 per day.
--   prune_rate_limits(): the hourly cron's sweep of private.rate_limit_hits. private.rate_limit only cleans the same
--   subject+bucket on its next call, so an idle member's rows would otherwise stay. A row is pruned once its
--   window_start is older than 2 days: 1 day of margin plus the longest window in use (1 day: invite_create,
--   withdrawal). A future bucket with a longer window must widen this margin. service_role only.

create function public.prune_rate_limits()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from private.rate_limit_hits h where h.window_start < now() - interval '2 days';
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n);
end;
$$;

-- create_invite: latest definition 20261019700101_rate_limits.sql, plus the F5-R17 exemption.
create or replace function public.create_invite(p_max_uses int, p_expires_in_hours int)
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_invite public.invites;
begin
  if not public.is_active_member() or not public.has_global_perm(16) then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 invites per day; F5-R17: ADMINISTRATOR is exempt (onboarding a cohort)
  if not public.has_global_perm(512) then
    perform private.rate_limit(public.current_member_id()::text, 'invite_create', 30, interval '1 day');
  end if;

  if p_max_uses is null or p_max_uses not between 1 and 100
     or p_expires_in_hours is null or p_expires_in_hours not between 1 and 720 then
    raise exception 'invalid_input';
  end if;

  v_member := public.current_member_id();

  insert into public.invites (code, created_by, max_uses, expires_at)
  values (
    translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_'),
    v_member,
    p_max_uses,
    now() + make_interval(hours => p_expires_in_hours)
  )
  returning * into v_invite;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_member, 'invite_created', 'invite', v_invite.id,
          jsonb_build_object('max_uses', p_max_uses, 'expires_in_hours', p_expires_in_hours));

  return v_invite;
end;
$$;

-- ===== grants (create or replace keeps create_invite's) =====
revoke execute on function public.prune_rate_limits() from public, anon, authenticated;
grant execute on function public.prune_rate_limits() to service_role;
