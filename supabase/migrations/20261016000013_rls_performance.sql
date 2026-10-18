-- Performance: Row Level Security policies that call auth.uid(), auth_role() or is_super_admin()
-- directly are evaluated once PER ROW (each call looks up the caller's profile). Wrapping the
-- call in a scalar sub-select lets Postgres evaluate it once per query (an InitPlan), as
-- recommended by Supabase. Access rules are unchanged: every expression below is the same
-- condition as in 20261012000002_security.sql, only wrapped.
--
-- Covers the tables that grow with use (submissions and their children, publications, checks,
-- tasks, notifications, activity log). Policies that depend on a column of the row being
-- checked (e.g. is_my_submission(submission_id)) cannot be hoisted and are left as they are.

alter policy assignments_admin on public.intern_assignments
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
alter policy assignments_self_read on public.intern_assignments
  using (intern_id = (select auth.uid()) and (select public.auth_role()) = 'intern');

alter policy tasks_admin on public.tasks
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
alter policy tasks_intern_read on public.tasks
  using (intern_id = (select auth.uid()) and (select public.auth_role()) = 'intern');

alter policy submissions_admin_read on public.backlink_submissions using ((select public.is_super_admin()));
alter policy submissions_intern_read on public.backlink_submissions
  using (intern_id = (select auth.uid()) and (select public.auth_role()) = 'intern');

alter policy versions_admin_read on public.submission_versions using ((select public.is_super_admin()));
alter policy files_admin_read on public.submission_files using ((select public.is_super_admin()));
alter policy events_admin_read on public.submission_events using ((select public.is_super_admin()));
alter policy internal_reviews_admin_read on public.internal_reviews using ((select public.is_super_admin()));
alter policy client_approvals_admin_read on public.client_approvals using ((select public.is_super_admin()));

alter policy published_admin_read on public.published_backlinks using ((select public.is_super_admin()));
alter policy published_intern_read on public.published_backlinks
  using (intern_id = (select auth.uid()) and (select public.auth_role()) = 'intern');

alter policy checks_admin_read on public.verification_checks using ((select public.is_super_admin()));
alter policy checks_intern_read on public.verification_checks
  using (published_backlink_id in (select pb.id from public.published_backlinks pb where pb.intern_id = (select auth.uid())));

alter policy notifications_own_read on public.notifications using (user_id = (select auth.uid()));
alter policy notifications_own_update on public.notifications
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter policy activity_admin_read on public.activity_logs using ((select public.is_super_admin()));

-- Interns' published links and verification checks are filtered by intern_id, which had no index.
create index if not exists published_intern_idx on public.published_backlinks (intern_id);
