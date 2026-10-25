-- P4 Task 2: rate limit by IP for the public checker and the API (P4-R6).
--
-- The caller (server, service role) sends a subject 'ip:' || hex(hmac-sha256(ip, service key))[0:32] (IPv6 reduced to
-- its /64 first), or 'ip:unknown' when no IP is recognisable (one shared, stricter bucket). The IP itself never reaches
-- Postgres. The counter is the F5 one (private.rate_limit_hits via private.rate_limit); no new private function is added.
--
-- Buckets (fixed windows, same mechanics as rate_limit_hit):
--   checker_web      30 / 10 min   the public checker page
--   api_free         60 / 1 h      the free API /api/v1/check/*
--   api_paid_attempt 300 / 1 h     paid-mode requests that carry a PAYMENT-SIGNATURE, before the facilitator is asked
-- A hit past the max raises rate_limited, and that raise rolls the increment back: a rejected hit does not count, so a
-- limited caller is free again when the window turns. An unknown bucket or a subject that is not exactly
-- 'ip:' + 32 lowercase hex (or 'ip:unknown') raises invalid_input.
create function public.ip_rate_limit_hit(p_subject text, p_bucket text)
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
  else
    raise exception 'invalid_input';
  end if;
end;
$$;

revoke execute on function public.ip_rate_limit_hit(text, text) from public, anon, authenticated;
grant execute on function public.ip_rate_limit_hit(text, text) to service_role;
