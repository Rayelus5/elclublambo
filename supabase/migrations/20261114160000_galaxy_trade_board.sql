-- Galaxy Survivor (the owner, 2026-11-14: «un tablón público» of trades). A player posts what they give (up to
-- `market.tradeGalaxies` galaxies and/or coins) and what they are after (rarities, a type, a palette, a phenomenon, or
-- coins), with a short note; anyone answers it with a trade that asks what the post gives (`trades.post_id`). Nothing of
-- a post is held: its galaxies stay the author's to use, and an answer that names one gone fails. The author accepting
-- one answer closes the post and cancels the other answers (their holds back, by the trades' own trigger).

create table galaxy.trade_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references galaxy.accounts (id) on delete cascade,
  -- The coins the author gives with it (0 when none).
  coins bigint not null default 0 check (coins >= 0),
  -- What the author is after: {tiers: [...], type?, palette?, phenomenon?, coins: bool}; nothing named is «propuestas».
  wants jsonb not null default '{}'::jsonb,
  note text not null default '' check (char_length(note) <= 140),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  check ((status = 'open') = (closed_at is null)),
  check (expires_at > created_at)
);
create table galaxy.trade_post_items (
  post_id uuid not null references galaxy.trade_posts (id) on delete cascade,
  galaxy_id uuid not null references galaxy.galaxies (id) on delete cascade,
  primary key (post_id, galaxy_id)
);
-- The board (the newest open first, a page at a time), an author's posts, the ones due, a galaxy's posts.
create index trade_posts_board on galaxy.trade_posts (created_at desc, id desc) where status = 'open';
create index trade_posts_author on galaxy.trade_posts (author_id, created_at desc);
create index trade_posts_due on galaxy.trade_posts (expires_at) where status = 'open';
create index trade_post_items_galaxy on galaxy.trade_post_items (galaxy_id);

-- An answer to a post is a trade that names it; a post's open answers.
alter table galaxy.trades add column post_id uuid references galaxy.trade_posts (id) on delete set null;
create index trades_post on galaxy.trades (post_id) where status = 'open';

alter table galaxy.trade_posts enable row level security;
alter table galaxy.trade_post_items enable row level security;
create policy galaxy_api_all on galaxy.trade_posts for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.trade_post_items for all to galaxy_api using (true) with check (true);
revoke all on galaxy.trade_posts, galaxy.trade_post_items from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.trade_posts to galaxy_api;
grant select, insert on galaxy.trade_post_items to galaxy_api;
