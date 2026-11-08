-- Galaxy Survivor M6c-1 (GDD §16.4): the report queue. A moderator reviews a reported message once: hides it or keeps it
-- visible. Only its last review is kept here (the audit log keeps every one), and only reports newer than it count:
-- they put the message back in the queue and toward hiding it again.

create table galaxy.chat_report_reviews (
  message_id bigint primary key references galaxy.chat_messages (id) on delete cascade,
  outcome text not null check (outcome in ('hidden', 'kept')),
  by_id uuid references galaxy.accounts (id) on delete set null,
  reason text not null check (length(reason) between 3 and 300),
  reviewed_at timestamptz not null default now()
);

create index chat_reports_message_time on galaxy.chat_reports (message_id, created_at);

alter table galaxy.chat_report_reviews enable row level security;
create policy galaxy_api_all on galaxy.chat_report_reviews for all to galaxy_api using (true) with check (true);
revoke all on galaxy.chat_report_reviews from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.chat_report_reviews to galaxy_api;
