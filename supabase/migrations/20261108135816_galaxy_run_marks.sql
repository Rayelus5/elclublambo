-- Galaxy Survivor M6d-3 (GDD §16.2): an admin marks or unmarks a finished run as suspicious from the panel, after
-- replaying it. A finished run stays as it was kept except for `suspicious` and `flags` (who changed them, when and why
-- is in admin_audit_log); every other column still raises run_finished.

create or replace function galaxy.runs_finish_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.finished_at is not null
     and (to_jsonb(new) - 'suspicious' - 'flags') is distinct from (to_jsonb(old) - 'suspicious' - 'flags') then
    raise exception 'run_finished';
  end if;
  return new;
end;
$$;
revoke all on function galaxy.runs_finish_once() from public, anon, authenticated, service_role;
