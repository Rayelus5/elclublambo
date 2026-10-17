-- F2c Task 4: message reports with a moderation queue.
-- Reports keep a snapshot (author + first 1000 chars) so evidence survives message deletion.
-- Writes only through RPCs; the queue is readable by members holding MANAGE_MESSAGES (8) in the report's channel.

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages (id) on delete set null,
  channel_id uuid not null references public.channels (id) on delete cascade,
  reporter_id uuid not null references public.members (id),
  reason text not null check (reason in ('scam', 'spam', 'abuse', 'other')),
  note text check (note is null or char_length(note) <= 500),
  snapshot_author_id uuid not null references public.members (id),
  snapshot_text text not null,
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolved_by uuid references public.members (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index reports_open_message_reporter_uidx on public.reports (message_id, reporter_id)
  where status = 'open';
create index reports_channel_status_idx on public.reports (channel_id, status, created_at desc);
create index reports_message_idx on public.reports (message_id) where message_id is not null;
create index reports_reporter_created_idx on public.reports (reporter_id, created_at desc);
create index reports_snapshot_author_idx on public.reports (snapshot_author_id);
create index reports_resolved_by_idx on public.reports (resolved_by) where resolved_by is not null;

alter table public.reports enable row level security;
revoke all on public.reports from anon;
revoke insert, update, delete, truncate on public.reports from authenticated;

create policy reports_select on public.reports
  for select to authenticated
  using (channel_id in (select v.id from public.visible_channels() v) and public.can(channel_id, 8));

-- Check order (documented, tested): forbidden (missing / own / deleted / not visible / inactive member: one
-- indistinguishable error, so no existence oracle) -> invalid_input -> already_reported -> rate_limited.
-- Rate limit: at most 10 reports per reporter in the last hour, any status; serialized per reporter.
create function public.report_message(p_message uuid, p_reason text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  m public.messages;
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() or p_message is null then
    raise exception 'forbidden';
  end if;
  select * into m from public.messages x where x.id = p_message;
  if not found or m.deleted_at is not null or m.author_id = v_me or not public.can_view(m.channel_id) then
    raise exception 'forbidden';
  end if;
  if p_reason is null or p_reason not in ('scam', 'spam', 'abuse', 'other')
     or (p_note is not null and char_length(p_note) > 500) then
    raise exception 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || v_me::text, 0));

  if exists (
    select 1 from public.reports r where r.message_id = m.id and r.reporter_id = v_me and r.status = 'open'
  ) then
    raise exception 'already_reported';
  end if;
  if (
    select count(*) from public.reports r where r.reporter_id = v_me and r.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'rate_limited';
  end if;

  insert into public.reports (message_id, channel_id, reporter_id, reason, note, snapshot_author_id, snapshot_text)
  values (m.id, m.channel_id, v_me, p_reason, nullif(btrim(p_note), ''), m.author_id, left(m.body_text, 1000))
  returning id into v_id;

  -- One notice per staff member (active, MANAGE_MESSAGES in the channel), never the reporter. No message_id:
  -- the per-(recipient, message) unique index must not swallow a second report of the same message.
  insert into public.notifications (recipient_id, kind, actor_id, channel_id, data)
  select s.id, 'report_new', v_me, m.channel_id, jsonb_build_object('report_id', v_id)
  from public.members s
  where s.status = 'active'
    and s.id <> v_me
    and (public.channel_permissions(s.id, m.channel_id) & 8) = 8;

  return v_id;
end;
$$;

-- Resolves every open report of the same message (or just this one when the message is gone). Returns the count.
create function public.resolve_report(p_report uuid, p_status text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  r public.reports;
  v_n int;
begin
  if v_me is null or not public.is_active_member() or p_report is null then
    raise exception 'forbidden';
  end if;
  select * into r from public.reports x where x.id = p_report;
  if not found or not public.can(r.channel_id, 8) then
    raise exception 'forbidden';
  end if;
  if p_status is null or p_status not in ('dismissed', 'actioned') then
    raise exception 'invalid_input';
  end if;

  update public.reports x
  set status = p_status, resolved_by = v_me, resolved_at = now()
  where x.status = 'open'
    and case when r.message_id is null then x.id = r.id else x.message_id = r.message_id end;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (v_me, 'report_resolved', 'report', r.id,
            jsonb_build_object('status', p_status, 'count', v_n, 'message_id', r.message_id));
  end if;
  return v_n;
end;
$$;

revoke execute on function public.report_message(uuid, text, text), public.resolve_report(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.report_message(uuid, text, text), public.resolve_report(uuid, text)
  to authenticated;
