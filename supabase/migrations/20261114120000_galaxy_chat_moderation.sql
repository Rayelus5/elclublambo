-- Galaxy Survivor (the owner's chat asks, 2026-11-14: «moderación de admin más sencilla y completa, que soporte
-- 100.000 mensajes»). The panel searches every chat by text (trigram index, any part of a word), by author, by channel,
-- hidden or not, reported or not and by dates, newest first by id; each message carries its reports (all, the ones
-- waiting since its last review, and the newest one's time), kept by triggers, so the queue reads one partial index.
-- «Eliminar» is a hide that cannot be undone (`hidden_reason = 'deleted'`): the text stays as evidence until retention
-- removes it, like any other.

create extension if not exists pg_trgm with schema extensions;

create index chat_messages_body_trgm on galaxy.chat_messages using gin (body extensions.gin_trgm_ops);
-- Hidden ones included (the players' index leaves them out).
create index chat_messages_all on galaxy.chat_messages (channel, id desc);
create index chat_messages_author on galaxy.chat_messages (author_id, id desc);
create index chat_messages_created on galaxy.chat_messages (created_at);

alter table galaxy.chat_messages drop constraint if exists chat_messages_hidden_reason_check;
alter table galaxy.chat_messages add constraint chat_messages_hidden_reason_check check (hidden_reason in ('moderator', 'reports', 'deleted'));

alter table galaxy.chat_messages
  add column report_count integer not null default 0 check (report_count >= 0),
  add column report_pending integer not null default 0 check (report_pending >= 0),
  add column report_last_at timestamptz;

-- A report: one more, one more waiting, and the newest.
create function galaxy.chat_report_counted() returns trigger language plpgsql set search_path = '' as $$
begin
  update galaxy.chat_messages
     set report_count = report_count + 1,
         report_pending = report_pending + 1,
         report_last_at = greatest(coalesce(report_last_at, new.created_at), new.created_at)
   where id = new.message_id;
  return null;
end $$;
create trigger chat_reports_counted after insert on galaxy.chat_reports for each row execute function galaxy.chat_report_counted();

-- A review: what waits is only what came after it.
create function galaxy.chat_review_counted() returns trigger language plpgsql set search_path = '' as $$
begin
  update galaxy.chat_messages m
     set report_pending = (select count(*) from galaxy.chat_reports r where r.message_id = new.message_id and r.created_at > new.reviewed_at)
   where m.id = new.message_id;
  return null;
end $$;
create trigger chat_reviews_counted after insert or update on galaxy.chat_report_reviews for each row execute function galaxy.chat_review_counted();

-- The reports there already are.
update galaxy.chat_messages m
   set report_count = x.n, report_pending = x.pending, report_last_at = x.last_at
  from (
    select r.message_id, count(*)::int as n, max(r.created_at) as last_at,
           (count(*) filter (where v.reviewed_at is null or r.created_at > v.reviewed_at))::int as pending
      from galaxy.chat_reports r
      left join galaxy.chat_report_reviews v on v.message_id = r.message_id
     group by r.message_id
  ) x
 where m.id = x.message_id;

-- The queue: what waits, the most recently reported first.
create index chat_messages_queue on galaxy.chat_messages (report_last_at desc, id desc) where report_pending > 0;
