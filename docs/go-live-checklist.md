# LinkOps go-live checklist

Steps that have to be done by a person in the Supabase, email provider, DNS, hosting and GitHub dashboards. They are listed in the order to do them. Code-level setup is in the [README](../README.md).

Do everything against a **staging** Supabase project first, run §8, and only then repeat on production.

---

## 1. Supabase project

1. Create the project at supabase.com. Use the **Pro** plan for production: Free projects pause when inactive and have no point-in-time restore.
2. Apply the database migrations, in order, from a trusted machine:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   This applies everything in `supabase/migrations/`, including these four:

   | Migration | What it does |
   |---|---|
   | `20261016000010_fix_invite_activation.sql` | Invited users can complete their first sign-in |
   | `20261016000011_rate_limit_server_only.sql` | The rate limiter can only be called by the server |
   | `20261016000012_report_email_tracking.sql` | Records whether each scheduled report email was sent, so failures are retried |
   | `20261016000013_rls_performance.sql` | Faster access checks on large tables, plus one new index |

   All four only add or replace functions, policies, columns and an index. None of them changes or deletes existing records.

   > **If any user already exists in production with the status `invited`,** they can sign in normally once migration 10 is applied. No manual SQL is needed.
3. **Authentication → URL Configuration**
   - Site URL: `https://<your-domain>`
   - Redirect URLs: add `https://<your-domain>/auth/confirm`
4. **Authentication → Email Templates.** For each of *Confirm signup*, *Invite user* and *Reset password*, paste the matching file from `supabase/templates/`: `confirmation.html`, `invite.html` and `recovery.html`. Use these subjects:
   - Confirm your LinkOps account
   - You're invited to LinkOps
   - Reset your LinkOps password
5. **Authentication → Providers → Email**
   - Confirm email: **on**
   - Minimum password length: **10** (same rule as the app)
   - Email OTP / link expiry: 3600 seconds (the default) is fine
6. **Authentication → Rate Limits.** Review the email-sending and sign-in limits. Keep the defaults unless you expect bursts of invitations.
7. **Authentication → Attack Protection.** Enable **CAPTCHA** (Cloudflare Turnstile or hCaptcha). Supabase's auth API is public, so this protects sign-in and sign-up even when someone calls it directly instead of using the app.
8. **Database → Backups.** Confirm daily backups are on. Add the PITR add-on if you need to restore to an exact minute.
9. **Project Settings → API.** Copy the project URL, the anon key and the service role key for §4. **Never** commit the service role key.

## 2. Email sending (custom SMTP)

Without this, confirmation, invitation and password-reset emails will not reliably reach users.

1. Create an account with an email provider. **Resend** is recommended because the app already uses it for digests and reports. Postmark and Amazon SES also work.
2. In the provider, add your sending domain (for example `mail.your-domain.com`) and copy the DNS records it gives you.
3. At your domain's DNS host, add:
   - the **SPF** TXT record, and
   - the **DKIM** record(s), exactly as the provider shows them;
   - a **DMARC** TXT record at `_dmarc.your-domain.com`. Start with `v=DMARC1; p=none; rua=mailto:dmarc@your-domain.com`, then move to `p=quarantine` after a week of clean reports.
4. Wait until the provider shows the domain as **verified**.
5. In Supabase → **Authentication → SMTP Settings**: enable custom SMTP and enter the provider's host, port (465 or 587), username and password. Set the sender to `LinkOps <no-reply@your-domain.com>`.
6. Create an API key in the provider for the app's own emails (§4: `RESEND_API_KEY`).

## 3. Choose the host

Pick **one**:

- **Vercel (recommended, simplest).** Use the **Pro** plan: Hobby doesn't allow commercial use. `vercel.json` already schedules the daily job.
- **Cloudflare Workers.** Use the **Workers Paid** plan. Deploy with `npm run cf:deploy` and set secrets with `npx wrangler secret put <NAME>`. In `wrangler.jsonc`, consider raising `limits.cpu_ms`, because report generation is CPU-heavy.

Once chosen, tell the developer so the other platform's config files can be removed.

## 4. Environment variables (in the hosting dashboard)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (**secret**). Also required for sign-in rate limiting |
| `NEXT_PUBLIC_APP_URL` | `https://<your-domain>`. **Required in production**: emailed links are not sent without it |
| `CRON_SECRET` | A long random string, e.g. the output of `openssl rand -hex 32` |
| `RESEND_API_KEY` | From §2 step 6 (optional: notification digests and scheduled report emails) |
| `EMAIL_FROM` | e.g. `LinkOps <reports@your-domain.com>` (optional, with the key above) |

After the first deployment, the server logs print `[startup] missing production configuration: …` if anything required is missing.

## 5. GitHub

1. Repository → **Settings → Pages**: set the source to **None** (turns GitHub Pages off).
2. Repository → **Actions**: confirm the **CI** workflow runs green on the next push.
3. Optional: **Settings → Branches**, then protect `main` and require the **CI / check** status before merging.

## 6. Create the Super Admin

From a trusted machine with `.env.local` pointing at the project:
```bash
npm run bootstrap:admin -- you@your-domain.com "Your Name"
```
Open the invitation email, press **Accept invitation**, set a password, and you land on the admin dashboard.

## 7. Monitoring

1. Add an uptime monitor (UptimeRobot, Better Stack, or your host's own) for `GET https://<your-domain>/api/health`. 200 means healthy, 503 means down.
2. Turn on alerts for the daily job:
   - **Vercel:** Settings → Cron Jobs shows each run. Add a log drain or alert on `[cron] completed with errors`.
   - **Cloudflare:** Workers → your worker → Logs; alert on `[cron]` lines that don't end in `200`.
3. Optional: error tracking such as Sentry. Server errors are logged as one JSON line with `"event":"request_error"`. To forward them, add the call in `src/instrumentation.ts`.
4. **Test a restore once:** restore the latest backup into a spare Supabase project and confirm you can sign in there.

## 8. Staging run-through (before inviting real users)

Do each step with real accounts and real email inboxes (one Gmail and one Outlook address):

1. [ ] Super Admin: accept the invite → set the password → admin dashboard opens.
2. [ ] Invite an intern and a client user → both accept → each lands on their own dashboard.
3. [ ] Self-register at `/signup` → the confirmation email arrives (inbox, not spam) → *Continue* → "awaiting approval" page.
4. [ ] Try to sign in before confirming → **Resend confirmation email** works.
5. [ ] Super Admin approves the registration with a role and features → the user sees only those features.
6. [ ] Create a client, campaign, keyword and task. The intern submits work → review → client approval → publication → **Check now** verification.
7. [ ] Edit and delete something (a draft task, a keyword not in use). Records with history can only be archived, which is expected.
8. [ ] Password reset from `/forgot-password` → the email arrives → *Continue* → set a new password → sign in.
9. [ ] Disable a user → they lose access immediately.
10. [ ] Trigger the daily job once:
    ```bash
    curl -H "Authorization: Bearer $CRON_SECRET" https://<staging-domain>/api/cron/daily
    ```
    Expect HTTP 200 and `"ok": true`.
11. [ ] On a phone: sign in, open the menu, open a table and a form dialog.
