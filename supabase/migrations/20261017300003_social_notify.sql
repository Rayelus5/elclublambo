-- F2c Task 3: invite and member-review notices (triggers on F1 tables, F1 functions untouched),
-- plus Task 2 review minors folded into _notify_message (same signature and grants).
-- Recipients come from invites.created_by, bans.sponsor_member_id and global permission bits, never from role names.

-- ===== Task 2 review minors =====
-- (a) with p_only_mentions (edits) skip recipients that already have a row for the message BEFORE calling
--     channel_permissions; (b) dropped the final ORDER BY: INSERT ... SELECT order has no effect on the result,
--     the priority is resolved by DISTINCT ON in the subquery.
create or replace function public._notify_message(p_message uuid, p_only_mentions boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
  v_default text;
  v_data jsonb;
begin
  select * into m from public.messages x where x.id = p_message;
  if not found or m.deleted_at is not null then
    return;
  end if;
  select c.default_follow into v_default from public.channels c where c.id = m.channel_id;
  v_data := case when m.thread_root_id is null then '{}'::jsonb
                 else jsonb_build_object('thread_root_id', m.thread_root_id) end;

  insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, data)
  select r.recipient, r.kind, m.author_id, m.channel_id, m.id,
         case when r.kind = 'channel_message' then '{}'::jsonb else v_data end
  from (
    select distinct on (cand.recipient) cand.recipient, cand.kind
    from (
      -- direct member mentions: never suppressed by mute
      select mm.target_id as recipient, 'mention'::text as kind, 1 as prio
      from public.message_mentions mm
      where mm.message_id = m.id and mm.kind = 'member' and mm.notify

      union all
      -- role mentions (notify only when the author had MENTION_EVERYONE): skip members who muted the channel
      select mr.member_id, 'mention', 1
      from public.message_mentions mm
      join public.member_roles mr on mr.role_id = mm.target_id
      where mm.message_id = m.id and mm.kind = 'role' and mm.notify
        and not exists (
          select 1 from public.channel_follow_prefs f
          where f.member_id = mr.member_id and f.channel_id = m.channel_id and f.level = 'mute')

      union all
      -- @everyone: every active member, minus muted
      select mb.id, 'mention', 1
      from public.message_mentions mm
      join public.members mb on mb.status = 'active'
      where mm.message_id = m.id and mm.kind = 'everyone' and mm.notify
        and not exists (
          select 1 from public.channel_follow_prefs f
          where f.member_id = mb.id and f.channel_id = m.channel_id and f.level = 'mute')

      union all
      -- replies: root author, earlier participants of the thread
      select a.author_id, 'reply', 2
      from (
        select r0.author_id from public.messages r0
        where not p_only_mentions and m.thread_root_id is not null and r0.id = m.thread_root_id
        union
        select r1.author_id from public.messages r1
        where not p_only_mentions and m.thread_root_id is not null and r1.thread_root_id = m.thread_root_id
          and r1.id <> m.id and r1.deleted_at is null
      ) a

      union all
      -- quoted message author
      select q.author_id, 'reply', 2
      from public.messages q
      where not p_only_mentions and m.quoted_message_id is not null and q.id = m.quoted_message_id

      union all
      -- followers of the channel at level 'all': root messages only
      select mb.id, 'channel_message', 3
      from public.members mb
      left join public.channel_follow_prefs f on f.member_id = mb.id and f.channel_id = m.channel_id
      where not p_only_mentions and m.thread_root_id is null and mb.status = 'active'
        and coalesce(f.level, v_default) = 'all'
    ) cand
    where cand.recipient is not null and cand.recipient <> m.author_id
    order by cand.recipient, cand.prio
  ) r
  join public.members rm on rm.id = r.recipient and rm.status = 'active'
  where case
          -- edits: anyone who already has a row for this message is skipped before the permission walk
          when p_only_mentions and exists (
            select 1 from public.notifications n where n.recipient_id = r.recipient and n.message_id = m.id) then false
          else (public.channel_permissions(r.recipient, m.channel_id) & 1) = 1
        end
  on conflict (recipient_id, message_id) where message_id is not null do nothing;
end;
$$;

-- ===== invite_redeemed =====
create function public._notify_invite_redeemed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, kind, actor_id)
  select i.created_by, 'invite_redeemed', new.member_id
  from public.invites i
  join public.members c on c.id = i.created_by and c.status = 'active'
  where i.id = new.invite_id
    and i.created_by <> new.member_id;
  return null;
end;
$$;

create trigger invite_redemptions_notify after insert on public.invite_redemptions
  for each row execute function public._notify_invite_redeemed();

-- ===== godchild_banned / sponsor_penalized =====
create function public._notify_ban()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sponsor_member_id is null or new.sponsor_member_id = new.member_id then
    return null;
  end if;
  insert into public.notifications (recipient_id, kind, actor_id)
  select s.id,
         case when new.sponsor_penalized then 'sponsor_penalized' else 'godchild_banned' end,
         new.member_id
  from public.members s
  where s.id = new.sponsor_member_id and s.status = 'active';
  return null;
end;
$$;

create trigger bans_notify after insert on public.bans
  for each row execute function public._notify_ban();

-- ===== member_review =====
-- Staff = active members with BAN_MEMBERS (32) or ADMINISTRATOR (512) globally; the flagged member is never a recipient.
create function public._notify_member_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, kind, actor_id)
  select s.id, 'member_review', new.id
  from public.members s
  where s.status = 'active'
    and s.id <> new.id
    and (public.member_global_permissions(s.id) & (32 | 512)) <> 0;
  return null;
end;
$$;

create trigger members_review_notify after update of needs_review_since on public.members
  for each row
  when (old.needs_review_since is null and new.needs_review_since is not null)
  execute function public._notify_member_review();

revoke execute on function
  public._notify_invite_redeemed(),
  public._notify_ban(),
  public._notify_member_review()
from public, anon, authenticated, service_role;
