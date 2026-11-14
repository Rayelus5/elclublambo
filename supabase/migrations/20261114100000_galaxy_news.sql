-- The news board (the owner, 2026-11-14: «un tablón de anuncios mucho más visual … totalmente personalizable de forma
-- intuitiva desde admin»). Cards by section, with an image (the game's own gallery or an uploaded one) and a link
-- into the game or out to a URL. «auto» cards take their words from the live game (patch notes, events, season,
-- multipliers, Discord): one of each, the admin places them, gives them an image and shows or hides them.
-- Uploaded images live here (small, a few dozen at most) and are served by the API from the same origin.

create table galaxy.media_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  bytes int not null check (bytes > 0 and bytes <= 2097152),
  width int not null check (width between 1 and 8192),
  height int not null check (height between 1 and 8192),
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  data bytea not null,
  created_by uuid references galaxy.accounts (id) on delete set null,
  created_at timestamptz not null default now()
);

create table galaxy.news_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('custom', 'auto:patch', 'auto:events', 'auto:season', 'auto:boosts', 'auto:discord')),
  section text not null check (section in ('destacado', 'comunidad', 'eventos', 'novedades')),
  title text not null default '' check (char_length(title) <= 60),
  body text not null default '' check (char_length(body) <= 400),
  image jsonb,
  link jsonb,
  featured boolean not null default false,
  sort int not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  hidden boolean not null default false,
  created_by uuid references galaxy.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or starts_at < ends_at),
  -- A custom card says something: an auto one's words come from the game.
  check (kind <> 'custom' or char_length(title) >= 1)
);
create unique index news_posts_auto on galaxy.news_posts (kind) where kind <> 'custom';
create index news_posts_board on galaxy.news_posts (section, sort, created_at);

alter table galaxy.media_assets enable row level security;
alter table galaxy.news_posts enable row level security;
create policy galaxy_api_all on galaxy.media_assets for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.news_posts for all to galaxy_api using (true) with check (true);
revoke all on galaxy.media_assets, galaxy.news_posts from public, anon, authenticated, service_role;
grant select, insert, delete on galaxy.media_assets to galaxy_api;
grant select, insert, update, delete on galaxy.news_posts to galaxy_api;

-- The auto cards, each once, with the game's own images and where they lead.
insert into galaxy.news_posts (kind, section, image, link, featured, sort) values
  ('auto:discord', 'comunidad', '{"kind": "gallery", "key": "discord"}', '{"kind": "url", "href": "https://discord.gg/2TA8RvKXv3", "label": "Unirme"}', true, 0),
  ('auto:season', 'comunidad', '{"kind": "gallery", "key": "temporada"}', '{"kind": "route", "to": "/temporada", "label": "Ver la temporada"}', false, 1),
  ('auto:events', 'eventos', '{"kind": "gallery", "key": "evento"}', '{"kind": "route", "to": "/misiones", "label": "Ver el evento"}', true, 0),
  ('auto:boosts', 'eventos', '{"kind": "gallery", "key": "multiplicadores"}', null, false, 1),
  ('auto:patch', 'novedades', '{"kind": "gallery", "key": "notas"}', '{"kind": "route", "to": "/notas-de-version", "label": "Leer las notas"}', false, 0);
