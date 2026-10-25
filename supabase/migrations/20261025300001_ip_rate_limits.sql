-- P4 Task 2: rate limit by IP for the public checker and the free API (P4-R6).
--
-- The caller (server, service role) sends a subject 'ip:' || hex(hmac-sha256(ip, service key))[0:32], or 'ip:unknown'
-- when no IP is recognisable (one shared, stricter bucket). The IP itself never reaches Postgres. The counter is the
-- F5 one (private.rate_limit_hits via private.rate_limit); no new private function is added.
--
-- New buckets (fixed windows, same mechanics as rate_limit_hit):
--   checker_web 30 / 10 min   the public checker page
--   api_free    60 / 1 h      the free API /api/v1/check/*
-- A hit past the max raises rate_limited; an unknown bucket or a subject that is not 'ip:...' (<= 80 chars) raises
-- invalid_input. Unlike the in-RPC buckets, the pre-hit is its own transaction, so a rejected hit still counts.
create function public.ip_rate_limit_hit(p_subject text, p_bucket text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_subject is null or p_subject !~ '^ip:' or char_length(p_subject) > 80 then
    raise exception 'invalid_input';
  end if;
  if p_bucket = 'checker_web' then
    perform private.rate_limit(p_subject, 'checker_web', 30, interval '10 minutes');
  elsif p_bucket = 'api_free' then
    perform private.rate_limit(p_subject, 'api_free', 60, interval '1 hour');
  else
    raise exception 'invalid_input';
  end if;
end;
$$;

revoke execute on function public.ip_rate_limit_hit(text, text) from public, anon, authenticated;
grant execute on function public.ip_rate_limit_hit(text, text) to service_role;
