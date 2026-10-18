-- Fix: check_rate_limit(key, limit, window) was executable by anon, with every parameter chosen
-- by the caller. Anyone holding the public anon key could reset a counter (window = 0), lock a
-- real user out of sign-in by pumping their key, or insert unlimited rows.
--
-- The limiter is now callable only by the server (service role), which fixes the limits and
-- windows in code (src/server/auth-actions.ts). Old rows are purged by the daily job.
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

create or replace function public.purge_rate_limits(p_older_than_seconds integer default 86400)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.rate_limits
    where window_start < now() - make_interval(secs => greatest(p_older_than_seconds, 3600));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.purge_rate_limits(integer) from public, anon, authenticated;
grant execute on function public.purge_rate_limits(integer) to service_role;
