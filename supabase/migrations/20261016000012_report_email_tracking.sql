-- Delivery tracking for scheduled report emails. Previously a failed send was never retried:
-- the report row already existed, so the next daily run skipped it as "already generated".
-- The daily job now records each attempt here and retries unsent reports (up to 3 attempts).
alter table public.reports
  add column email_status text check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  add column email_attempts integer not null default 0 check (email_attempts >= 0),
  add column email_last_error text,
  add column emailed_at timestamptz;

comment on column public.reports.email_status is
  'Scheduled reports only: pending = not yet sent, sent, failed = gave up after retries, skipped = no recipients or email not configured. NULL for manual reports.';

create index reports_email_retry_idx on public.reports (created_at) where email_status = 'pending';
