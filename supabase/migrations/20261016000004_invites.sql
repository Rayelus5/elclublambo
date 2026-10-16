-- F1 invitations: create / revoke / redeem. redeem_invite is the only gate into the forum.

-- Creators and BAN_MEMBERS holders read invites; everything else goes through RPCs.
create policy invites_select on public.invites
  for select to authenticated
  using (public.is_active_member() and (created_by = public.current_member_id() or public.has_global_perm(32)));

create function public.create_invite(p_max_uses int, p_expires_in_hours int)
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

create function public.revoke_invite(p_invite_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_invite public.invites;
  v_reason text;
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  v_member := public.current_member_id();

  select * into v_invite from public.invites i where i.id = p_invite_id for update;
  if not found then
    raise exception 'invite_not_found';
  end if;

  if v_invite.created_by <> v_member and not public.has_global_perm(32) then
    raise exception 'forbidden';
  end if;

  v_reason := coalesce(nullif(btrim(p_reason), ''), 'revoked_by_user');
  if char_length(v_reason) > 200 then
    raise exception 'invalid_input';
  end if;

  -- Already revoked: keep the original revoked_at/reason (no-op, no audit).
  if v_invite.revoked_at is not null then
    return;
  end if;

  update public.invites
     set revoked_at = now(), revoked_reason = v_reason
   where id = v_invite.id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_member, 'invite_revoked', 'invite', v_invite.id,
          jsonb_build_object('reason', v_reason));
end;
$$;

create function public.redeem_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet text;
  v_invite public.invites;
  v_creator uuid;
  v_creator_status text;
  v_member_id uuid;
begin
  v_wallet := public.auth_wallet_address();
  if auth.uid() is null or v_wallet is null then
    raise exception 'not_authenticated';
  end if;

  if exists (
    select 1 from public.members m
    where m.auth_user_id = auth.uid() or m.wallet_address = v_wallet
  ) then
    raise exception 'already_member';
  end if;

  -- Lock order: creator (share) before invite (update), same as ban_member (member, then invites).
  select i.created_by into v_creator from public.invites i where i.code = p_code;
  if not found then
    raise exception 'invite_not_found';
  end if;

  select m.status into v_creator_status from public.members m where m.id = v_creator for share;

  select * into v_invite from public.invites i where i.code = p_code for update;
  if not found then
    raise exception 'invite_not_found';
  end if;

  if v_invite.revoked_at is not null or v_creator_status is distinct from 'active' then
    raise exception 'invite_revoked';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite_expired';
  end if;
  if v_invite.uses >= v_invite.max_uses then
    raise exception 'invite_exhausted';
  end if;

  begin
    insert into public.members (auth_user_id, wallet_address, invited_by_member_id, invite_id, status)
    values (auth.uid(), v_wallet, v_invite.created_by, v_invite.id, 'active')
    returning id into v_member_id;
  exception when unique_violation then
    -- Concurrent redemption by the same user/wallet passed the pre-check.
    raise exception 'already_member';
  end;

  update public.invites set uses = uses + 1 where id = v_invite.id;

  insert into public.invite_redemptions (invite_id, member_id)
  values (v_invite.id, v_member_id);

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_member_id, 'invite_redeemed', 'invite', v_invite.id,
          jsonb_build_object('code_prefix', left(v_invite.code, 4)));

  return v_member_id;
end;
$$;

revoke execute on function
  public.create_invite(int, int),
  public.revoke_invite(uuid, text),
  public.redeem_invite(text)
from public, anon;

grant execute on function
  public.create_invite(int, int),
  public.revoke_invite(uuid, text),
  public.redeem_invite(text)
to authenticated;
