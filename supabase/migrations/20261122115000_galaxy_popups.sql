-- Galaxy Survivor: «Encuestas y avisos» (plan 2026-11-22, part A; GDD §16.5). An admin publishes popups that come up
-- when a player opens the game, for everyone or for a list or a segment of players: a survey (one scale), a review
-- (stars and maybe a text), a form (1 to 10 questions) or a promotion (a big image and «Ver más»). Answering may pay a
-- reward, only to accounts that existed when it was published. «Más tarde» brings it back in another session, three
-- shows at most and never twice the same Madrid day, and nobody sees more than one popup a day [U].
--   popup_campaigns   one row per campaign: its record (texts, questions, image, link, audience, dates, priority,
--                     reward), draft or published (whether it is scheduled, live or over comes from its dates and
--                     `ended_at`), its version and who did what. A published campaign never changes: it only ends, or
--                     goes back to draft before anyone saw it. Only drafts are deleted; a promotion has no questions
--                     nor reward, and needs its image to be published; 90 days at most.
--   popup_views       per account: how many times it was shown (3 at most), the Madrid day of the last show (one
--                     popup a day: unique per account and day), the «Más tarde» taps, when it was done (answered, or
--                     a promotion closed) and when «Ver más» was followed.
--   popup_responses   the guard row of an answer: one per account and campaign, with the operation's key and the
--                     reward paid, or why it was not (`self`: who published it, `staff`, `newcomer`: a newer account).
--   popup_answers     one row per question answered: a score, some options or a text, exactly one, so the panel can
--                     add them up. Answers and responses go only with their campaign or their account.

create table galaxy.popup_campaigns (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('survey', 'review', 'form', 'promotion')),
  title text not null check (char_length(title) between 1 and 80),
  body text not null default '' check (char_length(body) <= 1200),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 10),
  image_media uuid references galaxy.media_assets (id),
  link jsonb check (link is null or jsonb_typeof(link) = 'object'),
  audience jsonb not null default '{"kind":"all"}'::jsonb check (jsonb_typeof(audience) = 'object'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  priority smallint not null default 1 check (priority between 0 and 2),
  reward jsonb not null default '[]'::jsonb check (jsonb_typeof(reward) = 'array' and jsonb_array_length(reward) <= 20),
  -- Its reward needed a superadmin when it was published.
  big boolean not null default false,
  state text not null default 'draft' check (state in ('draft', 'published')),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  created_by uuid references galaxy.accounts (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references galaxy.accounts (id) on delete set null,
  published_at timestamptz,
  published_by uuid references galaxy.accounts (id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references galaxy.accounts (id) on delete set null,
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '90 days'),
  check ((state = 'published') = (published_at is not null)),
  check (ended_at is null or state = 'published'),
  -- A promotion is only looked at: nothing to answer and nothing to pay; its image is what it shows [U].
  constraint popup_campaigns_promotion check (kind <> 'promotion' or (jsonb_array_length(questions) = 0 and jsonb_array_length(reward) = 0)),
  constraint popup_campaigns_promotion_image check (kind <> 'promotion' or state = 'draft' or image_media is not null),
  constraint popup_campaigns_link check (link is null or kind = 'promotion')
);
create index popup_campaigns_live on galaxy.popup_campaigns (ends_at) where state = 'published' and ended_at is null;
create index popup_campaigns_media on galaxy.popup_campaigns (image_media) where image_media is not null;

create table galaxy.popup_views (
  campaign_id uuid not null references galaxy.popup_campaigns (id) on delete cascade,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  shows smallint not null default 0 check (shows between 0 and 3),
  first_shown_at timestamptz,
  last_shown_at timestamptz,
  last_shown_day date,
  dismissals smallint not null default 0 check (dismissals >= 0 and dismissals <= shows),
  done_at timestamptz,
  clicked_at timestamptz,
  primary key (campaign_id, account_id),
  check ((shows = 0) = (last_shown_day is null)),
  check (clicked_at is null or done_at is not null)
);
-- One popup a day over every campaign [U]: an account's views never share their last day.
create unique index popup_views_one_a_day on galaxy.popup_views (account_id, last_shown_day) where last_shown_day is not null;

create table galaxy.popup_responses (
  campaign_id uuid not null references galaxy.popup_campaigns (id) on delete cascade,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  op_key text not null check (char_length(op_key) between 1 and 120),
  answered_at timestamptz not null default now(),
  -- What each gift of the reward gave (null: no reward, or skipped).
  reward jsonb check (reward is null or jsonb_typeof(reward) = 'array'),
  reward_skipped text check (reward_skipped is null or reward_skipped in ('self', 'staff', 'newcomer')),
  primary key (campaign_id, account_id),
  check (reward is null or reward_skipped is null)
);
create index popup_responses_campaign on galaxy.popup_responses (campaign_id, answered_at);

create table galaxy.popup_answers (
  id bigint generated always as identity primary key,
  campaign_id uuid not null,
  account_id uuid not null,
  question_id text not null check (question_id ~ '^[a-z0-9]{1,12}$'),
  score smallint check (score is null or score between 0 and 10),
  choices text[] check (choices is null or cardinality(choices) between 1 and 8),
  text text check (text is null or char_length(text) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, account_id) references galaxy.popup_responses (campaign_id, account_id) on delete cascade,
  unique (campaign_id, account_id, question_id),
  check (num_nonnulls(score, choices, text) = 1)
);
create index popup_answers_question on galaxy.popup_answers (campaign_id, question_id);
-- A text question's answers, newest first, 50 at a time.
create index popup_answers_texts on galaxy.popup_answers (campaign_id, question_id, id desc) where text is not null;

-- A published campaign never changes its record: it only ends (once), or goes back to draft while nobody saw it and it
-- has not ended. Only drafts are deleted (their views, if any, go with them). Who did it may only be cleared (an
-- account's key sets it to null).
create function galaxy.popup_campaigns_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then
      raise exception 'popup_campaigns_keep_history';
    end if;
    return old;
  end if;
  if old.state = 'draft' then
    return new;
  end if;
  if (new.kind, new.title, new.body, new.questions, new.image_media, new.link, new.audience, new.starts_at, new.ends_at, new.priority, new.reward, new.created_at)
     is distinct from (old.kind, old.title, old.body, old.questions, old.image_media, old.link, old.audience, old.starts_at, old.ends_at, old.priority, old.reward, old.created_at)
     or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    raise exception 'popup_campaign_fixed';
  end if;
  if new.state = 'draft' then
    if old.ended_at is not null or exists (select 1 from galaxy.popup_views v where v.campaign_id = old.id) then
      raise exception 'popup_campaign_seen';
    end if;
    return new;
  end if;
  if new.published_at is distinct from old.published_at
     or new.big is distinct from old.big
     or (new.published_by is distinct from old.published_by and new.published_by is not null)
     or (old.ended_at is not null and (new.ended_at is distinct from old.ended_at or (new.ended_by is distinct from old.ended_by and new.ended_by is not null))) then
    raise exception 'popup_campaign_fixed';
  end if;
  return new;
end;
$$;
revoke all on function galaxy.popup_campaigns_guard() from public, anon, authenticated, service_role;
create trigger popup_campaigns_guard
  before update or delete on galaxy.popup_campaigns
  for each row execute function galaxy.popup_campaigns_guard();

-- An answer is never changed, and goes only with its campaign or its account (their cascade: the parent row is already
-- gone when it reaches here).
create function galaxy.popup_rows_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'popup_answers' then
      if not exists (select 1 from galaxy.popup_responses r where r.campaign_id = old.campaign_id and r.account_id = old.account_id) then
        return old;
      end if;
    elsif not exists (select 1 from galaxy.popup_campaigns c where c.id = old.campaign_id)
       or not exists (select 1 from galaxy.accounts a where a.id = old.account_id) then
      return old;
    end if;
    raise exception 'popup_rows_keep_history';
  end if;
  raise exception 'popup_rows_fixed';
end;
$$;
revoke all on function galaxy.popup_rows_guard() from public, anon, authenticated, service_role;
create trigger popup_responses_guard before update or delete on galaxy.popup_responses
  for each row execute function galaxy.popup_rows_guard();
create trigger popup_answers_guard before update or delete on galaxy.popup_answers
  for each row execute function galaxy.popup_rows_guard();

alter table galaxy.popup_campaigns enable row level security;
alter table galaxy.popup_views enable row level security;
alter table galaxy.popup_responses enable row level security;
alter table galaxy.popup_answers enable row level security;
create policy galaxy_api_all on galaxy.popup_campaigns for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.popup_views for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.popup_responses for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.popup_answers for all to galaxy_api using (true) with check (true);
revoke all on galaxy.popup_campaigns, galaxy.popup_views, galaxy.popup_responses, galaxy.popup_answers from public, anon, authenticated, service_role;
-- Deletes only reach drafts and their cascade (the triggers refuse the rest).
grant select, insert, update, delete on galaxy.popup_campaigns, galaxy.popup_views, galaxy.popup_responses, galaxy.popup_answers to galaxy_api;
grant usage on sequence galaxy.popup_answers_id_seq to galaxy_api;
