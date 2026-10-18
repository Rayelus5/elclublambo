-- F3a Task 1: member profiles. Handle (mandatory, set through the welcome), bio, links and avatar live on
-- public.members and are written only through SECURITY DEFINER RPCs: direct UPDATE on members is revoked.
-- Avatars live in the public `avatars` bucket under <member_id>/<uuid>.<ext>.

create extension if not exists citext with schema extensions;

-- ===== columns =====
alter table public.members
  add column handle extensions.citext unique,
  add column handle_changed_at timestamptz,
  add column bio text,
  add column links jsonb not null default '[]'::jsonb,
  add column welcome_completed_at timestamptz;

-- mirrors the regex used by set_handle (lowercase only: the RPC lowercases before storing)
alter table public.members
  add constraint members_handle_format check (handle::text ~ '^[a-z0-9_]{3,20}$');

-- ===== members are no longer directly writable =====
-- The column-level grant of F1 is separate from the table-level privilege: revoke both.
revoke update on public.members from authenticated;
revoke update (display_name, avatar_path) on public.members from authenticated;
drop policy members_update_own on public.members;

-- ===== set_handle =====
-- Returns the stored handle. Input is trimmed (ASCII whitespace) and validated as ASCII BEFORE lowercasing, so
-- Unicode look-alikes (cyrillic a, kelvin sign, fullwidth letters) can never be folded into an ASCII handle.
-- Lowercasing is an explicit ASCII translate, independent of the database locale.
create function public.set_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_raw text;
  v_handle text;
  v_cur text;
  v_changed timestamptz;
  v_reserved constant text[] := array['admin', 'administrador', 'superadmin', 'elclub', 'el_club', 'sistema', 'system',
    'soporte', 'support', 'moderador', 'mod', 'staff', 'everyone', 'here', 'todos', 'anonimo', 'null', 'undefined'];
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  v_raw := regexp_replace(coalesce(p_handle, ''), '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g');
  if v_raw !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'handle_invalid';
  end if;
  v_handle := translate(v_raw, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  if v_handle = any (v_reserved) then
    raise exception 'handle_reserved';
  end if;

  select m.handle::text, m.handle_changed_at into v_cur, v_changed
  from public.members m where m.id = v_me for update;

  if v_cur = v_handle then
    return v_cur;
  end if;
  if v_cur is not null and v_changed is not null and v_changed > now() - interval '30 days' then
    raise exception 'handle_cooldown';
  end if;

  begin
    update public.members set handle = v_handle, handle_changed_at = now() where id = v_me;
  exception when unique_violation then
    raise exception 'handle_taken';
  end;
  return v_handle;
end;
$$;

-- ===== update_profile =====
create function public.update_profile(p_display_name text, p_bio text, p_links jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_name text;
  v_bio text;
  v_links jsonb := coalesce(p_links, '[]'::jsonb);
  v_link jsonb;
  v_url text;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;

  v_name := nullif(regexp_replace(coalesce(p_display_name, ''), '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g'), '');
  if v_name is not null and (char_length(v_name) not between 2 and 32 or v_name ~ '[[:cntrl:]]') then
    raise exception 'invalid_input';
  end if;

  v_bio := nullif(regexp_replace(coalesce(p_bio, ''), '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g'), '');
  if v_bio is not null and char_length(v_bio) > 280 then
    raise exception 'bio_too_long';
  end if;

  if jsonb_typeof(v_links) <> 'array' or jsonb_array_length(v_links) > 3 then
    raise exception 'links_invalid';
  end if;
  for v_link in select e from jsonb_array_elements(v_links) e loop
    if jsonb_typeof(v_link) <> 'string' then
      raise exception 'links_invalid';
    end if;
    v_url := v_link #>> '{}';
    if char_length(v_url) > 200
       or v_url ~ '[[:cntrl:][:space:]]'
       or v_url !~* '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}(:[0-9]{1,5})?([/?#].*)?$' then
      raise exception 'links_invalid';
    end if;
  end loop;

  update public.members set display_name = v_name, bio = v_bio, links = v_links where id = v_me;
end;
$$;

-- ===== set_avatar =====
-- The object must exist in the avatars bucket under the caller's own folder; Storage metadata is the only
-- authority for mime and size and a missing value fails closed. Null clears the avatar.
create function public.set_avatar(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_meta jsonb;
  v_found boolean;
  v_mime text;
  v_size text;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_path is null then
    update public.members set avatar_path = null where id = v_me;
    return;
  end if;
  if p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
     or split_part(p_path, '/', 1) <> v_me::text then
    raise exception 'avatar_invalid';
  end if;
  select true, o.metadata into v_found, v_meta
  from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path;
  if v_found is not true then
    raise exception 'avatar_invalid';
  end if;
  v_mime := v_meta ->> 'mimetype';
  v_size := v_meta ->> 'size';
  if v_mime is null or v_mime not in ('image/png', 'image/jpeg', 'image/webp')
     or v_size is null or v_size !~ '^[0-9]{1,9}$' or v_size::bigint not between 1 and 2097152 then
    raise exception 'avatar_invalid';
  end if;
  update public.members set avatar_path = p_path where id = v_me;
end;
$$;

-- ===== complete_welcome =====
create function public.complete_welcome()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_handle text;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select m.handle::text into v_handle from public.members m where m.id = v_me;
  if v_handle is null then
    raise exception 'handle_required';
  end if;
  update public.members set welcome_completed_at = coalesce(welcome_completed_at, now()) where id = v_me;
end;
$$;

revoke execute on function public.set_handle(text) from public, anon, authenticated, service_role;
revoke execute on function public.update_profile(text, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.set_avatar(text) from public, anon, authenticated, service_role;
revoke execute on function public.complete_welcome() from public, anon, authenticated, service_role;
grant execute on function public.set_handle(text) to authenticated;
grant execute on function public.update_profile(text, text, jsonb) to authenticated;
grant execute on function public.set_avatar(text) to authenticated;
grant execute on function public.complete_welcome() to authenticated;

-- ===== avatars bucket =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: <member_id>/<uuid>.<ext>. No UPDATE policy (no overwrite / upsert). The regex is checked inside CASE
-- (no AND short-circuit guarantee in a policy); only text comparisons are used, no uuid casts.
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
        then split_part(name, '/', 1) = (select public.current_member_id())::text
             and (select public.is_active_member())
      else false
    end
  );

-- Public bucket: object URLs are served without RLS. SELECT is still needed by Storage (INSERT ... RETURNING,
-- DELETE ... WHERE), and avatars are visible to every active member anyway.
create policy avatars_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (select public.is_active_member()));

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = (select public.current_member_id())::text
    and (select public.is_active_member())
  );

-- ===== search_members: handle + avatar =====
drop function public.search_members(text, int);
create function public.search_members(p_q text, p_limit int default 10)
returns table (id uuid, display_name text, wallet_address text, handle text, avatar_path text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_raw text := btrim(left(coalesce(p_q, ''), 100));
  v_name text;
  v_handle text;
  v_hex text;
  v_limit int := greatest(1, least(10, coalesce(p_limit, 10)));
begin
  if char_length(v_raw) < 2 then
    return;
  end if;
  -- same order on both sides: unaccent, then lower
  v_name := '%' || replace(replace(replace(lower(public.f_unaccent(v_raw)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- handles match by prefix; a leading @ is ignored
  v_handle := replace(replace(replace(lower(regexp_replace(v_raw, '^@', '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_hex := case when lower(v_raw) ~ '^(0x)?[0-9a-f]{4,}$' then '0x' || regexp_replace(lower(v_raw), '^0x', '') || '%' end;
  return query
    select m.id, m.display_name, m.wallet_address, m.handle::text, m.avatar_path
    from public.members m
    where m.status = 'active'
      and (lower(public.f_unaccent(coalesce(m.display_name, ''))) like v_name escape '\'
           or m.handle::text like v_handle escape '\'
           or (v_hex is not null and m.wallet_address like v_hex))
    order by m.display_name nulls last, m.handle nulls last, m.wallet_address
    limit v_limit;
end;
$$;

revoke execute on function public.search_members(text, int) from public, anon;
grant execute on function public.search_members(text, int) to authenticated;

-- ===== _push_build: actor name prefers @handle =====
-- Same body as 20261017300007; only the actor expression changes: @handle, else display_name, else short wallet.
create or replace function public._push_build(p_id bigint)
returns table (title text, body text, url text, tag text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  n public.notifications;
  v_perms bigint := 0;
  v_actor text;
  v_wallet text;
  v_channel text;
  v_subject text;
  v_phrase text;
  v_title text;
  v_url text;
  v_excerpt text;
  v_root text;
begin
  select * into n from public.notifications x where x.id = p_id;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.members m where m.id = n.recipient_id and m.status = 'active') then
    return;
  end if;
  if n.kind in ('mention', 'reply', 'channel_message') and n.channel_id is null then
    return;
  end if;
  if n.channel_id is not null then
    v_perms := public.channel_permissions(n.recipient_id, n.channel_id);
    if (v_perms & 1) = 0 then
      return;
    end if;
  end if;
  if n.ticket_id is not null and not public._member_can_access_ticket(n.recipient_id, n.ticket_id) then
    return;
  end if;
  if n.kind = 'report_new' and (v_perms & 8) = 0 then
    return;
  end if;
  if n.kind = 'member_review' and (public.member_global_permissions(n.recipient_id) & (32 | 512)) = 0 then
    return;
  end if;

  -- The actor's name always comes from members, never from user-controlled mention labels.
  -- The handle is regex-validated (^[a-z0-9_]{3,20}$), so it needs no sanitising.
  select coalesce('@' || a.handle::text,
                  nullif(btrim(regexp_replace(a.display_name, '[[:cntrl:]]+', ' ', 'g')), ''),
                  left(a.wallet_address, 6) || '…' || right(a.wallet_address, 4)),
         a.wallet_address
    into v_actor, v_wallet
  from public.members a where a.id = n.actor_id;
  v_actor := coalesce(v_actor, 'Alguien');

  if n.channel_id is not null then
    select btrim(regexp_replace(c.name, '[[:cntrl:]]+', ' ', 'g')) into v_channel
    from public.channels c where c.id = n.channel_id;
  end if;
  if n.ticket_id is not null then
    select btrim(regexp_replace(t.subject, '[[:cntrl:]]+', ' ', 'g')) into v_subject
    from public.tickets t where t.id = n.ticket_id;
  end if;

  v_url := '/notifications';
  if n.kind in ('mention', 'reply', 'channel_message') then
    v_url := '/c/' || n.channel_id::text;
    v_root := n.data ->> 'thread_root_id';
    if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_url := v_url || '?thread=' || v_root;
    end if;
    -- Excerpt only while the message exists, is not deleted and lives in the notification's channel (the recipient
    -- still sees that channel, checked above).
    select btrim(left(btrim(regexp_replace(m.body_text, '[[:space:][:cntrl:]]+', ' ', 'g')), 80)) into v_excerpt
    from public.messages m
    where m.id = n.message_id and m.channel_id = n.channel_id and m.deleted_at is null;
    v_excerpt := nullif(v_excerpt, '');
  elsif n.kind in ('invite_redeemed', 'godchild_banned', 'sponsor_penalized') then
    if v_wallet is not null then
      v_url := '/u/' || v_wallet;
    end if;
  elsif n.kind = 'report_new' then
    v_url := '/moderation/reports';
  elsif n.kind = 'member_review' then
    v_url := '/admin/members';
  elsif n.ticket_id is not null then
    v_url := '/tickets/' || n.ticket_id::text;
  end if;

  case n.kind
    when 'mention' then
      v_title := 'Nueva mención';
      v_phrase := v_actor || ' te mencionó en #' || coalesce(v_channel, '');
    when 'reply' then
      v_title := 'Nueva respuesta';
      v_phrase := v_actor || ' respondió en #' || coalesce(v_channel, '');
    when 'channel_message' then
      v_title := 'Nuevo mensaje';
      v_phrase := v_actor || ' publicó en #' || coalesce(v_channel, '');
    when 'invite_redeemed' then
      v_title := 'Invitación canjeada';
      v_phrase := v_actor || ' se unió con tu invitación';
    when 'godchild_banned' then
      v_title := 'Ahijado baneado';
      v_phrase := 'Tu ahijado ' || v_actor || ' ha sido baneado';
    when 'sponsor_penalized' then
      v_title := 'Penalización de padrino';
      v_phrase := 'Te han penalizado porque ' || v_actor || ' fue baneado';
    when 'report_new' then
      v_title := 'Nuevo reporte';
      v_phrase := v_actor || ' reportó un mensaje en #' || coalesce(v_channel, '');
    when 'member_review' then
      v_title := 'Miembro por revisar';
      v_phrase := v_actor || ' necesita revisión';
    when 'ticket_new' then
      v_title := 'Nuevo ticket';
      v_phrase := v_actor || ' abrió un ticket: ' || coalesce(v_subject, '');
    when 'ticket_reply' then
      v_title := 'Respuesta en un ticket';
      v_phrase := v_actor || ' escribió en el ticket: ' || coalesce(v_subject, '');
    when 'ticket_status' then
      if n.data ->> 'status' = 'closed' then
        v_title := 'Ticket cerrado';
        v_phrase := v_actor || ' cerró el ticket: ' || coalesce(v_subject, '');
      else
        v_title := 'Ticket reabierto';
        v_phrase := v_actor || ' reabrió el ticket: ' || coalesce(v_subject, '');
      end if;
    else
      return;
  end case;

  title := v_title;
  body := case when v_excerpt is not null then v_phrase || ': «' || v_excerpt || '»' else v_phrase end;
  url := v_url;
  tag := n.kind || ':' || coalesce(n.message_id::text, n.ticket_id::text, n.id::text);
  return next;
end;
$$;

revoke execute on function public._push_build(bigint) from public, anon, authenticated, service_role;
