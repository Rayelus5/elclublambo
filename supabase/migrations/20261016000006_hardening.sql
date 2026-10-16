-- F1 hardening: invites from a sponsor who lost CREATE_INVITES (e.g. demoted Padrino) stop admitting people.
-- Admins resolve to all bits (1023) in member_global_permissions, so they keep passing.

create or replace function public.redeem_invite(p_code text)
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

  if v_invite.revoked_at is not null
     or v_creator_status is distinct from 'active'
     or (public.member_global_permissions(v_creator) & 16) = 0 then
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
