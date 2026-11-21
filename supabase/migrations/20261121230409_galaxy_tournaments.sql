-- Galaxy Survivor: tournaments (plan «temporadas como fichas», part 5, 2026-11-21; GDD §13.3). An admin prepares a
-- tournament inside a season: its own ranking by the measure chosen (points, kills, runs, best run, depth, Cores,
-- extractions or the season's points), optional filters, an optional entry fee in game currency and prizes by place.
-- Only the runs after a player's sign-up count; leaving deletes the score and there is no way back. Nothing is paid
-- before a review: at its end the prize places' solo runs are replayed by the server, and an admin decides on what
-- cannot be checked. Prizes are collected on the tournament's page and never expire; money is paid outside the game.
--   tournaments          one row per tournament: its record (dates, rules, measure, filters, fee, prizes), its state
--                        (draft, scheduled, running, review, finished, cancelled) and who did what. Only drafts are
--                        ever deleted; a fee never goes with a cash prize; 28 days at most.
--   tournament_entries   who signed up, when, and with which key and fee; when they left (never back), the refund of a
--                        cancelled tournament, a disqualification, and the frozen result (rank, score, rewards, whether
--                        the account could win prizes) with its collection. Never deleted with its tournament alive.
--   tournament_checks    the review's replays: one per run, pending → ok, mismatch (the run became suspicious),
--                        unverifiable or error (both wait for an admin's decision: accept or discard).
--   tournament_cash      money prizes owed and when an admin marked them paid (once).
--   mailbox_messages.link  the in-game page a system message's button opens (a tournament's results).
--   runs                 an index for the tournaments' sums: an account's runs by when they finished.
--   prune_retention      keeps the recorded inputs of the runs entrants played for a tournament not yet finished (the
--                        review replays them).

create table galaxy.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  season_id text not null check (season_id ~ '^[a-z0-9-]{1,32}$'),
  title text not null check (char_length(title) between 1 and 60),
  summary text not null default '' check (char_length(summary) <= 200),
  rules text not null default '' check (char_length(rules) <= 4000),
  banner_media uuid references galaxy.media_assets (id),
  details_media uuid references galaxy.media_assets (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  state text not null default 'draft' check (state in ('draft', 'scheduled', 'running', 'review', 'finished', 'cancelled')),
  exclusive boolean not null default true,
  metric text not null check (metric in ('points', 'kills', 'runs', 'best_run', 'depth', 'cores', 'extractions', 'season_points')),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  entry jsonb check (entry is null or jsonb_typeof(entry) = 'object'),
  prizes jsonb not null default '[]'::jsonb check (jsonb_typeof(prizes) = 'array'),
  participation jsonb check (participation is null or jsonb_typeof(participation) = 'object'),
  review_hours integer not null default 24 check (review_hours between 0 and 168),
  max_entrants integer check (max_entrants is null or max_entrants >= 1),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  created_by uuid references galaxy.accounts (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references galaxy.accounts (id) on delete set null,
  scheduled_at timestamptz,
  scheduled_by uuid references galaxy.accounts (id) on delete set null,
  published_at timestamptz,
  cancelled_at timestamptz,
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '28 days'),
  -- A paid entry never goes with a money prize (the owner, 2026-11-21).
  constraint tournaments_fee_no_cash check (entry is null or not jsonb_path_exists(prizes, '$[*].cash ? (@ != null)'))
);
create index tournaments_state on galaxy.tournaments (state, starts_at);

create table galaxy.tournament_entries (
  tournament_id uuid not null references galaxy.tournaments (id) on delete cascade,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  entry_key text not null check (char_length(entry_key) between 1 and 120),
  fee jsonb check (fee is null or jsonb_typeof(fee) = 'object'),
  refunded_at timestamptz,
  disqualified boolean not null default false,
  disqualified_reason text check (disqualified_reason is null or char_length(disqualified_reason) <= 500),
  final_rank integer check (final_rank is null or final_rank >= 1),
  final_score bigint check (final_score is null or final_score >= 0),
  final_runs integer check (final_runs is null or final_runs >= 0),
  rewards jsonb check (rewards is null or jsonb_typeof(rewards) = 'object'),
  eligible boolean,
  claimed_at timestamptz,
  primary key (tournament_id, account_id)
);
-- Signing up checks the account's live entries (exclusive tournaments that overlap).
create index tournament_entries_account on galaxy.tournament_entries (account_id) where left_at is null;

create table galaxy.tournament_checks (
  tournament_id uuid not null references galaxy.tournaments (id) on delete cascade,
  run_id uuid not null references galaxy.runs (id),
  status text not null default 'pending' check (status in ('pending', 'ok', 'mismatch', 'error', 'unverifiable')),
  detail jsonb check (detail is null or jsonb_typeof(detail) = 'object'),
  decision text check (decision is null or decision in ('accept', 'discard')),
  decided_by uuid references galaxy.accounts (id) on delete set null,
  decided_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tournament_id, run_id),
  -- Only a run that could not be checked waits for a decision.
  check (decision is null or status in ('unverifiable', 'error'))
);
create index tournament_checks_pending on galaxy.tournament_checks (created_at) where status = 'pending';

create table galaxy.tournament_cash (
  tournament_id uuid not null references galaxy.tournaments (id) on delete cascade,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  rank integer not null check (rank >= 1),
  amount_eur numeric(10, 2) not null check (amount_eur > 0),
  note text not null default '' check (char_length(note) <= 200),
  paid_at timestamptz,
  paid_by uuid references galaxy.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, account_id)
);
create index tournament_cash_unpaid on galaxy.tournament_cash (created_at) where paid_at is null;

-- History stays: a tournament is deleted only as a draft (its rows go with it); an entry's sign-up, key and fee never
-- change, and what was set once (left, refunded, collected) stays set; a check or a cash prize goes only with its
-- tournament, and a cash prize is marked paid once.
create function galaxy.tournaments_keep_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state <> 'draft' then
    raise exception 'tournaments_keep_history';
  end if;
  return old;
end;
$$;
revoke all on function galaxy.tournaments_keep_history() from public, anon, authenticated, service_role;
create trigger tournaments_keep_history
  before delete on galaxy.tournaments
  for each row execute function galaxy.tournaments_keep_history();

create function galaxy.tournament_rows_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only the cascade of a deleted (draft) tournament.
    if not exists (select 1 from galaxy.tournaments t where t.id = old.tournament_id) then
      return old;
    end if;
    raise exception 'tournament_rows_keep_history';
  end if;
  if new.tournament_id is distinct from old.tournament_id then
    raise exception 'tournament_rows_keep_history';
  end if;
  if tg_table_name = 'tournament_entries' then
    if new.account_id is distinct from old.account_id
       or new.joined_at is distinct from old.joined_at
       or new.entry_key is distinct from old.entry_key
       or new.fee is distinct from old.fee
       or (old.left_at is not null and new.left_at is distinct from old.left_at)
       or (old.refunded_at is not null and new.refunded_at is distinct from old.refunded_at)
       or (old.claimed_at is not null and (new.claimed_at is distinct from old.claimed_at or new.rewards is distinct from old.rewards)) then
      raise exception 'tournament_entry_fixed';
    end if;
  elsif tg_table_name = 'tournament_cash' then
    if new.account_id is distinct from old.account_id
       or new.rank is distinct from old.rank
       or new.amount_eur is distinct from old.amount_eur
       or new.note is distinct from old.note
       or (old.paid_at is not null and (new.paid_at is distinct from old.paid_at or new.paid_by is distinct from old.paid_by)) then
      raise exception 'tournament_cash_fixed';
    end if;
  elsif tg_table_name = 'tournament_checks' then
    if new.run_id is distinct from old.run_id then
      raise exception 'tournament_rows_keep_history';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function galaxy.tournament_rows_guard() from public, anon, authenticated, service_role;
create trigger tournament_entries_guard before update or delete on galaxy.tournament_entries
  for each row execute function galaxy.tournament_rows_guard();
create trigger tournament_checks_guard before update or delete on galaxy.tournament_checks
  for each row execute function galaxy.tournament_rows_guard();
create trigger tournament_cash_guard before update or delete on galaxy.tournament_cash
  for each row execute function galaxy.tournament_rows_guard();

alter table galaxy.tournaments enable row level security;
alter table galaxy.tournament_entries enable row level security;
alter table galaxy.tournament_checks enable row level security;
alter table galaxy.tournament_cash enable row level security;
create policy galaxy_api_all on galaxy.tournaments for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.tournament_entries for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.tournament_checks for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.tournament_cash for all to galaxy_api using (true) with check (true);
revoke all on galaxy.tournaments, galaxy.tournament_entries, galaxy.tournament_checks, galaxy.tournament_cash from public, anon, authenticated, service_role;
-- Deletes only reach drafts and their cascade (the triggers refuse the rest).
grant select, insert, update, delete on galaxy.tournaments, galaxy.tournament_entries, galaxy.tournament_checks, galaxy.tournament_cash to galaxy_api;

alter table galaxy.mailbox_messages add column link text check (link is null or link ~ '^/[a-z0-9][a-z0-9/-]{0,119}$');

create index runs_account_finished on galaxy.runs (account_id, finished_at) where not suspicious;

create or replace function galaxy.prune_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inputs integer;
  chat integer;
begin
  perform set_config('galaxy.retention', 'on', true);
  delete from galaxy.run_inputs i
   using galaxy.runs r
   where r.id = i.run_id
     and i.created_at < now() - interval '30 days'
     and not r.suspicious
     and coalesce(r.boss_kills, 0) = 0
     and coalesce(r.depth, 0) < 3
     -- A run an entrant played for a tournament not yet finished: its review may replay it (from the season's start
     -- for the season's points).
     and not exists (
       select 1
         from galaxy.tournament_entries e
         join galaxy.tournaments t on t.id = e.tournament_id
         left join galaxy.seasons s on s.id = t.season_id
        where e.account_id = r.account_id
          and e.left_at is null
          and t.state in ('scheduled', 'running', 'review')
          and r.finished_at < t.ends_at
          and r.finished_at >= case when t.metric = 'season_points' then coalesce(s.starts_at, t.starts_at) else t.starts_at end
     );
  get diagnostics inputs = row_count;
  perform set_config('galaxy.retention', 'off', true);
  delete from galaxy.chat_messages m
   where m.created_at < now() - interval '90 days'
     and not exists (select 1 from galaxy.chat_reports c where c.message_id = m.id);
  get diagnostics chat = row_count;
  return jsonb_build_object('inputs', inputs, 'chat', chat);
end;
$$;
revoke all on function galaxy.prune_retention() from public, anon, authenticated, service_role;
grant execute on function galaxy.prune_retention() to galaxy_api;
