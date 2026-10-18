-- F3-R6 (author-deletion trap): delete_message refuses the author deleting their own bounty while it has a marked,
-- unpaid solution (bounty_has_solution), even when the author also holds MANAGE_MESSAGES. Moderators deleting someone
-- else's bounty are unaffected (the bounty then reads "removed", 20261018800020). Identical to 20261018700002 otherwise.
create or replace function public.delete_message(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_root uuid;
  v_root_row public.messages;
  v_perms bigint;
  v_paths text[];
  v_soft boolean;
  v_bounty boolean;
begin
  select * into v_msg from public.messages m where m.id = p_id;
  if v_actor is null or not found then
    raise exception 'forbidden';
  end if;
  -- lock order: thread root first, then the message (post/delete of replies serialize on the root)
  v_root := coalesce(v_msg.thread_root_id, v_msg.id);
  select * into v_root_row from public.messages r where r.id = v_root for update;
  select * into v_msg from public.messages m where m.id = p_id for update;
  if not found then
    raise exception 'forbidden';
  end if;

  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  -- a system notice (null author) can only be removed by a moderator (MANAGE_MESSAGES)
  if (v_perms & 1) = 0 or not (v_msg.author_id is not distinct from v_actor or (v_perms & 8) = 8) then
    raise exception 'forbidden';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'invalid_input';
  end if;
  -- F3-R6: the author cannot delete their own bounty while a marked solution is unpaid (it would keep its unpaid
  -- status with no way left to pay it). A moderator still can: the bounty then reads "removed".
  if v_msg.author_id is not distinct from v_actor and exists (
    select 1 from public.bounties b
    where b.message_id = p_id and b.solution_marked_at is not null and b.paid_at is null and b.cancelled_at is null
  ) then
    raise exception 'bounty_has_solution';
  end if;

  select coalesce(array_agg(a.storage_path order by a.storage_path), '{}') into v_paths
  from public.message_attachments a where a.message_id = p_id;

  if v_msg.author_id is distinct from v_actor then
    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (v_actor, 'message_deleted', 'message', p_id,
            jsonb_build_object('channel_id', v_msg.channel_id, 'author_id', v_msg.author_id));
  end if;

  -- ruling F3c-R1: a bounty message and its marked solution are only ever soft-deleted, so the bounties row
  -- (FK on delete restrict) and its unpaid status survive
  v_bounty := exists (select 1 from public.bounties b where b.message_id = p_id or b.solution_message_id = p_id);
  v_soft := v_bounty
            or (v_msg.thread_root_id is null
                and exists (select 1 from public.messages r where r.thread_root_id = p_id));

  if v_soft then
    delete from public.message_attachments where message_id = p_id;
    delete from public.message_reactions where message_id = p_id;
    delete from public.message_mentions where message_id = p_id;
    delete from public.alpha_details where message_id = p_id;
    update public.messages
    set body = '{"type":"doc","content":[]}'::jsonb, body_text = '',
        kind = case when kind = 'bounty' then kind else 'text' end, pinned_at = null,
        pinned_by = null, deleted_at = now(), deleted_by = v_actor
    where id = p_id;
    return jsonb_build_object('hard', false, 'paths', to_jsonb(v_paths));
  end if;

  delete from public.messages where id = p_id;

  if v_msg.thread_root_id is not null then
    update public.messages
    set reply_count = greatest(reply_count - 1, 0),
        last_reply_at = (select max(r.created_at) from public.messages r where r.thread_root_id = v_root)
    where id = v_root;
    -- a tombstone whose last reply is gone has nothing left to hold
    if v_root_row.deleted_at is not null
       and not exists (select 1 from public.bounties b where b.message_id = v_root)
       and not exists (select 1 from public.messages r where r.thread_root_id = v_root) then
      delete from public.messages where id = v_root;
    end if;
  end if;
  return jsonb_build_object('hard', true, 'paths', to_jsonb(v_paths));
end;
$$;

revoke execute on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;
