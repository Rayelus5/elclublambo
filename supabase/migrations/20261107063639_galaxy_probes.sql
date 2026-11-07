-- Galaxy Survivor M3b-2 (GDD §6, §12.2): the probe test. Each account answers it once; its answers and the starting
-- probe it gave are kept as they were (never rewritten or deleted). The other probes are unlocked from the account's
-- run stats (galaxy.runs), so they need no table.

create table galaxy.probe_tests (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  answers smallint[] not null check (
    array_length(answers, 1) between 5 and 6
    and 0 <= all (answers)
    and 2 >= all (answers)
  ),
  probe text not null check (probe ~ '^[a-z0-9-]{1,32}$'),
  created_at timestamptz not null default now()
);

create trigger probe_tests_append_only before update or delete on galaxy.probe_tests
  for each row execute function galaxy.forbid_mutation();

alter table galaxy.probe_tests enable row level security;
create policy galaxy_api_all on galaxy.probe_tests for all to galaxy_api using (true) with check (true);
revoke all on galaxy.probe_tests from public, anon, authenticated, service_role;
grant select, insert on galaxy.probe_tests to galaxy_api;
