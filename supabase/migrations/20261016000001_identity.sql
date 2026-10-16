-- F1 identity schema: deny-by-default (RLS enabled, no policies yet; Task 4 adds read policies).

create table public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  wallet_address text not null unique check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  display_name text check (char_length(display_name) between 2 and 32),
  avatar_path text,
  status text not null default 'active' check (status in ('active', 'banned', 'left')),
  invited_by_member_id uuid references public.members (id),
  invite_id uuid,
  is_bootstrap boolean not null default false,
  needs_review_since timestamptz,
  created_at timestamptz not null default now(),
  check (invited_by_member_id is not null or is_bootstrap)
);
create index members_invited_by_member_id_idx on public.members (invited_by_member_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_by uuid not null references public.members (id),
  max_uses int not null check (max_uses between 1 and 100),
  uses int not null default 0,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  check (uses <= max_uses)
);
create index invites_created_by_idx on public.invites (created_by);

alter table public.members
  add constraint members_invite_id_fkey
  foreign key (invite_id) references public.invites (id)
  deferrable initially deferred;

create table public.invite_redemptions (
  invite_id uuid not null references public.invites (id),
  member_id uuid not null unique references public.members (id),
  redeemed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index invite_redemptions_invite_id_idx on public.invite_redemptions (invite_id);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null check (color ~ '^#[0-9A-F]{6}$'),
  position int not null,
  permissions bigint not null default 0,
  is_everyone boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index roles_single_everyone_idx on public.roles (is_everyone) where is_everyone;

create table public.member_roles (
  member_id uuid not null references public.members (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, role_id)
);
create index member_roles_role_id_idx on public.member_roles (role_id);

create table public.member_permission_overrides (
  member_id uuid primary key references public.members (id) on delete cascade,
  allow bigint not null default 0,
  deny bigint not null default 0,
  reason text,
  set_by uuid references public.members (id),
  created_at timestamptz not null default now()
);

create table public.bans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  banned_by uuid not null references public.members (id),
  reason text not null,
  sponsor_member_id uuid references public.members (id),
  sponsor_penalized boolean not null default false,
  lifted_at timestamptz,
  created_at timestamptz not null default now()
);
create index bans_member_id_idx on public.bans (member_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_member_id uuid references public.members (id),
  action text not null,
  target_type text,
  target_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table public.app_config (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);

-- Seeds
insert into public.roles (name, color, position, permissions, is_everyone, is_system) values
  ('@everyone',  '#A3A3A3', 0,    7,   true,  false),
  ('Padrino',    '#61DFFF', 10,   16,  false, false),
  ('SuperAdmin', '#EDEDED', 1000, 512, false, true);

insert into public.app_config (key, value) values
  ('withdrawals_enabled', 'false'::jsonb),
  ('weighted_raffles_enabled', 'false'::jsonb);

-- Deny by default
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.invite_redemptions enable row level security;
alter table public.roles enable row level security;
alter table public.member_roles enable row level security;
alter table public.member_permission_overrides enable row level security;
alter table public.bans enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_config enable row level security;

revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
