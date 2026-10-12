-- Fix: 20261012000003_workflow.sql revokes EXECUTE on every public function and re-grants a
-- list that omitted record_sign_in(), so signed-in users could not call it and every login was
-- rejected as "not active". Restore the grant (signed-in users only; never anon).
grant execute on function public.record_sign_in() to authenticated;
