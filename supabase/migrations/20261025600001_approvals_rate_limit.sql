-- P6 Task 2: the approvals page's IP bucket (P6-R2e).
-- ip_rate_limit_hit(..., 'approvals_scan') 30 / 10 min per IP: each list load and each manual check is one hit.
-- The other branches are copied unchanged from 20261025500001_vouches.sql.
-- create or replace keeps the existing grants (service_role only).
create or replace function public.ip_rate_limit_hit(p_subject text, p_bucket text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_subject is null or p_subject !~ '^ip:([0-9a-f]{32}|unknown)$' then
    raise exception 'invalid_input';
  end if;
  if p_bucket = 'checker_web' then
    perform private.rate_limit(p_subject, 'checker_web', 30, interval '10 minutes');
  elsif p_bucket = 'api_free' then
    perform private.rate_limit(p_subject, 'api_free', 60, interval '1 hour');
  elsif p_bucket = 'api_paid_attempt' then
    perform private.rate_limit(p_subject, 'api_paid_attempt', 300, interval '1 hour');
  elsif p_bucket = 'vouch_refresh' then
    perform private.rate_limit(p_subject, 'vouch_refresh', 30, interval '10 minutes');
  elsif p_bucket = 'approvals_scan' then
    perform private.rate_limit(p_subject, 'approvals_scan', 30, interval '10 minutes');
  else
    raise exception 'invalid_input';
  end if;
end;
$$;
